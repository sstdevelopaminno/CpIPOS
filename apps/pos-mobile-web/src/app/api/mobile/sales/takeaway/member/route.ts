import { fail, ok } from "@/lib/api/response";
import { appendMobileAuditLog } from "@/lib/audit/mobile-audit-log";
import { requireActiveMobileSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const linkMemberSchema = z.object({
  orderId: z.string().uuid(),
  memberId: z.string().uuid(),
  points: z.coerce.number().int().min(0).max(1_000_000).default(0),
  stamps: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

type MemberRow = {
  id: string;
  name: string | null;
  phone: string | null;
  points_balance: number | null;
  stamp_balance: number | null;
};

type OrderRow = {
  id: string;
  order_no: string | null;
  grand_total: number | null;
  total_amount: number | null;
  metadata: Record<string, unknown> | null;
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
  return (message.includes("mobile_members") || message.includes("mobile_member_transactions")) && (message.includes("schema cache") || message.includes("does not exist"));
}

export async function POST(request: Request) {
  try {
    const scope = await requireActiveMobileSession({ refreshCookie: true });
    if (!scope) return fail("missing_session", "กรุณาเข้าสู่ระบบ", 401);

    const body = linkMemberSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return fail("invalid_input", "ข้อมูลสมาชิกหรือบิลไม่ถูกต้อง", 422);

    const supabase = createServiceClient();
    const [{ data: order, error: orderError }, { data: member, error: memberError }] = await Promise.all([
      supabase
        .from("orders")
        .select("id,order_no,grand_total,total_amount,metadata")
        .eq("id", body.data.orderId)
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId)
        .maybeSingle<OrderRow>(),
      supabase
        .from("mobile_members")
        .select("id,name,phone,points_balance,stamp_balance")
        .eq("id", body.data.memberId)
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId)
        .maybeSingle<MemberRow>(),
    ]);

    if (orderError) throw new Error(orderError.message);
    if (memberError) throw new Error(memberError.message);
    if (!order) return fail("order_not_found", "ไม่พบบิล", 404);
    if (!member) return fail("member_not_found", "ไม่พบสมาชิก", 404);

    const points = Number(body.data.points ?? 0);
    const stamps = Number(body.data.stamps ?? 0);
    const nextPoints = Number(member.points_balance ?? 0) + points;
    const nextStamps = Number(member.stamp_balance ?? 0) + stamps;
    const nowIso = new Date().toISOString();

    const { data: updatedMember, error: updateMemberError } = await supabase
      .from("mobile_members")
      .update({ points_balance: nextPoints, stamp_balance: nextStamps, updated_at: nowIso })
      .eq("id", member.id)
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .select("id,name,phone,points_balance,stamp_balance")
      .single<MemberRow>();
    if (updateMemberError) throw new Error(updateMemberError.message);

    const amount = Number(order.grand_total ?? order.total_amount ?? 0);
    await supabase.from("mobile_member_transactions").insert({
      tenant_id: scope.tenantId,
      branch_id: scope.branchId,
      member_id: member.id,
      order_id: order.id,
      order_no: order.order_no,
      amount,
      points_delta: points,
      stamps_delta: stamps,
      created_by: scope.userId,
      created_at: nowIso,
      metadata: { source_app: "CpIPOS Mobile", source_channel: "mobile_web", mode: "takeaway_bill_attach" },
    });

    await supabase
      .from("orders")
      .update({
        metadata: {
          ...(order.metadata ?? {}),
          member_id: member.id,
          member_name: updatedMember.name,
          member_phone: updatedMember.phone,
          member_points_earned: points,
          member_stamps_earned: stamps,
        },
        updated_at: nowIso,
      })
      .eq("id", order.id)
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId);

    await appendMobileAuditLog({
      scope,
      action: "mobile_takeaway_member_linked",
      targetTable: "orders",
      targetId: order.id,
      metadata: {
        order_no: order.order_no,
        member_id: member.id,
        member_name: updatedMember.name ?? null,
        points_delta: points,
        stamps_delta: stamps,
      },
    });

    return ok({ member: normalizeMember(updatedMember), points, stamps });
  } catch (error) {
    console.error("[takeaway.member]", error);
    if (isMissingMemberTable(error)) return fail("members_schema_missing", "ยังไม่ได้สร้างตารางสมาชิกใน Supabase", 501);
    return fail("member_link_failed", "ผูกสมาชิกกับบิลไม่สำเร็จ", 503);
  }
}
