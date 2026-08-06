import { fail, ok } from "@/lib/api/response";
import { appendMobileAuditLog } from "@/lib/audit/mobile-audit-log";
import { requireActiveMobileSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const createMemberSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().regex(/^\d{9,10}$/),
  points: z.coerce.number().int().min(0).max(1_000_000).optional(),
  stamps: z.coerce.number().int().min(0).max(1_000_000).optional(),
});

type MemberRow = {
  id: string;
  name: string | null;
  phone: string | null;
  points_balance: number | null;
  stamp_balance: number | null;
};

function normalizeMember(row: MemberRow) {
  return {
    id: row.id,
    name: row.name ?? "-",
    phone: row.phone ?? "",
    points: Number(row.points_balance ?? 0),
    stamps: Number(row.stamp_balance ?? 0),
  };
}

function isMissingMemberTable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("mobile_members") && (message.includes("schema cache") || message.includes("does not exist"));
}

export async function GET(request: Request) {
  try {
    const scope = await requireActiveMobileSession({ refreshCookie: true });
    if (!scope) return fail("missing_session", "กรุณาเข้าสู่ระบบ", 401);

    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    let query = createServiceClient()
      .from("mobile_members")
      .select("id,name,phone,points_balance,stamp_balance")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .order("updated_at", { ascending: false })
      .limit(30);

    if (q) query = query.or(`name.ilike.%${q.replace(/[%(),]/g, "")}%,phone.ilike.%${q.replace(/\D/g, "")}%`);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    return ok({ members: ((data ?? []) as MemberRow[]).map(normalizeMember) });
  } catch (error) {
    console.error("[mobile.members.GET]", error);
    if (isMissingMemberTable(error)) return fail("members_schema_missing", "ยังไม่ได้สร้างตารางสมาชิกใน Supabase", 501);
    return fail("members_load_failed", "โหลดสมาชิกไม่สำเร็จ", 503);
  }
}

export async function POST(request: Request) {
  try {
    const scope = await requireActiveMobileSession({ refreshCookie: true });
    if (!scope) return fail("missing_session", "กรุณาเข้าสู่ระบบ", 401);

    const body = createMemberSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return fail("invalid_input", "ข้อมูลสมาชิกไม่ถูกต้อง", 422);

    const nowIso = new Date().toISOString();
    const { data, error } = await createServiceClient()
      .from("mobile_members")
      .upsert({
        tenant_id: scope.tenantId,
        branch_id: scope.branchId,
        name: body.data.name,
        phone: body.data.phone,
        points_balance: body.data.points ?? 0,
        stamp_balance: body.data.stamps ?? 0,
        status: "active",
        updated_at: nowIso,
      }, { onConflict: "tenant_id,branch_id,phone" })
      .select("id,name,phone,points_balance,stamp_balance")
      .single<MemberRow>();

    if (error) throw new Error(error.message);
    await appendMobileAuditLog({
      scope,
      action: "mobile_member_saved",
      targetTable: "mobile_members",
      targetId: data.id,
      metadata: { member_id: data.id, name: data.name ?? null, phone: data.phone ?? null },
      afterData: { name: data.name ?? null, phone: data.phone ?? null, points: Number(data.points_balance ?? 0), stamps: Number(data.stamp_balance ?? 0) },
    });
    return ok({ member: normalizeMember(data) });
  } catch (error) {
    console.error("[mobile.members.POST]", error);
    if (isMissingMemberTable(error)) return fail("members_schema_missing", "ยังไม่ได้สร้างตารางสมาชิกใน Supabase", 501);
    return fail("member_save_failed", "บันทึกสมาชิกไม่สำเร็จ", 503);
  }
}
