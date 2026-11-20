import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { fail, ok } from "@/lib/http";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type MemberRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email?: string | null;
  member_token?: string | null;
  points_balance: number | null;
  stamp_balance: number | null;
  updated_at?: string | null;
};

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

function sanitizeSearch(value: string): string {
  return value.replace(/[%(),]/g, "").slice(0, 80);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

function normalizeMember(row: MemberRow) {
  const token = row.member_token ?? row.id;
  return {
    id: row.id,
    name: row.name ?? "-",
    phone: row.phone ?? "",
    email: row.email ?? "",
    member_token: token,
    portal_path: `/member/${encodeURIComponent(token)}`,
    points: Number(row.points_balance ?? 0),
    stamps: Number(row.stamp_balance ?? 0),
    updated_at: row.updated_at ?? null
  };
}

function isMissingMemberTable(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message.includes("mobile_members") && (message.includes("schema cache") || message.includes("does not exist") || message.includes("Could not find"));
}

function isMissingMemberColumn(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message.includes("mobile_members") && (message.includes("schema cache") || message.includes("Could not find")) && /email|member_token|deleted_at/i.test(message);
}

function newMemberToken(): string {
  return `mem_${crypto.randomUUID().replace(/-/g, "")}`;
}

function applySearch<T>(query: T, q: string): T {
  if (!q || typeof (query as { or?: unknown }).or !== "function") return query;
  const safeName = sanitizeSearch(q);
  const safePhone = digitsOnly(q);
  const safeToken = sanitizeSearch(q);
  const filters = [`name.ilike.%${safeName}%`, `email.ilike.%${safeName}%`, `member_token.ilike.%${safeToken}%`];
  if (safePhone) filters.unshift(`phone.ilike.${safePhone}%`);
  return (query as { or: (filters: string) => T }).or(filters.join(","));
}

function applyFallbackSearch<T>(query: T, q: string): T {
  if (!q || typeof (query as { or?: unknown }).or !== "function") return query;
  const safeName = sanitizeSearch(q);
  const safePhone = digitsOnly(q);
  const filters = [`name.ilike.%${safeName}%`];
  if (safePhone) filters.unshift(`phone.ilike.${safePhone}%`);
  return (query as { or: (filters: string) => T }).or(filters.join(","));
}

export async function GET(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:enter" });
    await requirePosApiFeature(auth, "core_pos_sales");
    const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
    const supabase = getSupabaseServiceClient();
    const selectFull = "id,name,phone,email,member_token,points_balance,stamp_balance,updated_at";
    const selectFallback = "id,name,phone,points_balance,stamp_balance,updated_at";

    const baseQuery = supabase
      .from("mobile_members")
      .select(selectFull)
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(q ? 25 : 30);

    let data: MemberRow[] | null = null;
    let error: { message: string } | null = null;
    const result = await applySearch(baseQuery, q);
    data = result.data as MemberRow[] | null;
    error = result.error;

    if (error && isMissingMemberColumn(error)) {
      const fallbackQuery = supabase
        .from("mobile_members")
        .select(selectFallback)
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .order("updated_at", { ascending: false })
        .limit(q ? 25 : 30);
      const fallback = await applyFallbackSearch(fallbackQuery, q);
      data = fallback.data as MemberRow[] | null;
      error = fallback.error;
    }

    if (error) throw new Error(error.message);
    return ok({ members: ((data ?? []) as MemberRow[]).map(normalizeMember) });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    if (isMissingMemberTable(error)) return fail("members_schema_missing", "ยังไม่พบตารางสมาชิกใน Supabase กรุณารัน migration ล่าสุดก่อนใช้งานสมาชิก", 501);
    return fail("members_load_failed", getErrorMessage(error) || "ไม่สามารถโหลดสมาชิกได้", 503);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:enter" });
    await requirePosApiFeature(auth, "core_pos_sales");
    const body = (await request.json().catch(() => ({}))) as { name?: string; phone?: string; email?: string; points?: number; stamps?: number };
    const name = String(body.name ?? "").trim();
    const phone = digitsOnly(String(body.phone ?? ""));
    const email = String(body.email ?? "").trim().toLowerCase();
    const points = Math.max(0, Math.floor(Number(body.points ?? 0)));
    const stamps = Math.max(0, Math.floor(Number(body.stamps ?? 0)));

    if (!name || !/^\d{9,10}$/.test(phone)) {
      return fail("invalid_member_input", "กรุณากรอกชื่อสมาชิกและเบอร์โทร 9-10 หลัก", 422);
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return fail("invalid_member_email", "รูปแบบอีเมลสมาชิกไม่ถูกต้อง", 422);
    }

    const nowIso = new Date().toISOString();
    const existingTokenResult = await getSupabaseServiceClient()
      .from("mobile_members")
      .select("member_token")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("phone", phone)
      .maybeSingle<{ member_token: string | null }>();
    const existingToken = existingTokenResult.error ? null : existingTokenResult.data?.member_token ?? null;

    let { data, error } = await getSupabaseServiceClient()
      .from("mobile_members")
      .upsert(
        {
          tenant_id: auth.tenantId!,
          branch_id: auth.branchId!,
          name,
          phone,
          email: email || null,
          member_token: existingToken || newMemberToken(),
          points_balance: points,
          stamp_balance: stamps,
          status: "active",
          deleted_at: null,
          updated_at: nowIso
        },
        { onConflict: "tenant_id,branch_id,phone" }
      )
      .select("id,name,phone,email,member_token,points_balance,stamp_balance,updated_at")
      .single<MemberRow>();

    if (error && isMissingMemberColumn(error)) {
      const fallback = await getSupabaseServiceClient()
        .from("mobile_members")
        .upsert(
          { tenant_id: auth.tenantId!, branch_id: auth.branchId!, name, phone, points_balance: points, stamp_balance: stamps, status: "active", updated_at: nowIso },
          { onConflict: "tenant_id,branch_id,phone" }
        )
        .select("id,name,phone,points_balance,stamp_balance,updated_at")
        .single<MemberRow>();
      data = fallback.data as MemberRow | null;
      error = fallback.error;
    }

    if (error) throw new Error(error.message);
    if (!data) throw new Error("member_save_returned_no_data");
    return ok({ member: normalizeMember(data) });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    if (isMissingMemberTable(error)) return fail("members_schema_missing", "ยังไม่พบตารางสมาชิกใน Supabase กรุณารัน migration ล่าสุดก่อนบันทึกสมาชิก", 501);
    return fail("member_save_failed", getErrorMessage(error) || "ไม่สามารถบันทึกสมาชิกได้", 503);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:enter" });
    await requirePosApiFeature(auth, "core_pos_sales");
    const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    if (!id) return fail("invalid_member_id", "ไม่พบรหัสสมาชิกที่ต้องการลบ", 422);

    let { error } = await getSupabaseServiceClient()
      .from("mobile_members")
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", id);

    if (error && isMissingMemberColumn(error)) {
      const hardDelete = await getSupabaseServiceClient().from("mobile_members").delete().eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!).eq("id", id);
      error = hardDelete.error;
    }

    if (error) throw new Error(error.message);
    return ok({ deleted: true });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    if (isMissingMemberTable(error)) return fail("members_schema_missing", "ยังไม่พบตารางสมาชิกใน Supabase กรุณารัน migration ล่าสุดก่อนลบสมาชิก", 501);
    return fail("member_delete_failed", getErrorMessage(error) || "ไม่สามารถลบสมาชิกได้", 503);
  }
}
