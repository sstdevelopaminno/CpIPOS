import { fail, ok } from "@/lib/api/response";
import { requireActiveMobileSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type MemberRow = {
  id: string;
  name: string | null;
  phone: string | null;
  points_balance: number | null;
  stamp_balance: number | null;
};

type HistoryRow = {
  id: string;
  order_no: string | null;
  amount: number | null;
  points_delta: number | null;
  stamps_delta: number | null;
  created_at: string | null;
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

export async function GET(_: Request, { params }: { params: Promise<{ memberId: string }> }) {
  try {
    const scope = await requireActiveMobileSession({ refreshCookie: true });
    if (!scope) return fail("missing_session", "กรุณาเข้าสู่ระบบ", 401);
    const { memberId } = await params;
    const supabase = createServiceClient();

    const [{ data: member, error: memberError }, { data: history, error: historyError }] = await Promise.all([
      supabase
        .from("mobile_members")
        .select("id,name,phone,points_balance,stamp_balance")
        .eq("id", memberId)
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId)
        .maybeSingle<MemberRow>(),
      supabase
        .from("mobile_member_transactions")
        .select("id,order_no,amount,points_delta,stamps_delta,created_at")
        .eq("tenant_id", scope.tenantId)
        .eq("branch_id", scope.branchId)
        .eq("member_id", memberId)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

    if (memberError) throw new Error(memberError.message);
    if (historyError) throw new Error(historyError.message);
    if (!member) return fail("member_not_found", "ไม่พบสมาชิก", 404);

    return ok({
      member: normalizeMember(member),
      history: ((history ?? []) as HistoryRow[]).map((item) => ({
        id: item.id,
        orderNo: item.order_no ?? "-",
        amount: Number(item.amount ?? 0),
        points: Number(item.points_delta ?? 0),
        stamps: Number(item.stamps_delta ?? 0),
        createdAt: item.created_at,
      })),
    });
  } catch (error) {
    console.error("[mobile.members.member.GET]", error);
    if (isMissingMemberTable(error)) return fail("members_schema_missing", "ยังไม่ได้สร้างตารางสมาชิกใน Supabase", 501);
    return fail("member_load_failed", "โหลดข้อมูลสมาชิกไม่สำเร็จ", 503);
  }
}
