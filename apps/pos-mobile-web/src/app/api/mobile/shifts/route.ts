import { fail, ok } from "@/lib/api/response";
import { appendMobileAuditLog } from "@/lib/audit/mobile-audit-log";
import { readMobileSession, requireActiveMobileSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";
import { z } from "zod";

const shiftActionSchema = z.object({
  action: z.enum(["open", "close"]),
  openingCash: z.coerce.number().min(0).max(1_000_000).optional(),
  closingCash: z.coerce.number().min(0).max(1_000_000).optional(),
});

type OpenShiftRow = {
  id: string;
  status: string;
  opened_at: string | null;
  opened_by: string | null;
  opening_cash: number | null;
  expected_cash: number | null;
  metadata: Record<string, unknown> | null;
};

type ActiveDineInOrderRow = {
  id: string;
  order_no: string | null;
  status: string | null;
  table_id: string | null;
};

type ActiveTableSessionRow = {
  id: string;
  order_id: string | null;
  table_id: string | null;
  metadata: Record<string, unknown> | null;
};

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isUniqueViolation(error: unknown) {
  return (error as { code?: string } | null)?.code === "23505";
}

async function findOpenShift(
  supabase: ReturnType<typeof createServiceClient>,
  scope: NonNullable<Awaited<ReturnType<typeof readMobileSession>>>,
) {
  const { data, error } = await supabase
    .from("shifts")
    .select("id,status,opened_at,opened_by,opening_cash,expected_cash,metadata")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("device_code", scope.deviceCode)
    .eq("status", "open")
    .maybeSingle<OpenShiftRow>();
  if (error) throw new Error(error.message);
  return data;
}

async function bindCurrentSessionToShift(
  supabase: ReturnType<typeof createServiceClient>,
  scope: NonNullable<Awaited<ReturnType<typeof readMobileSession>>>,
  shiftId: string,
) {
  const { error } = await supabase
    .from("pos_sessions")
    .update({ shift_id: shiftId })
    .eq("id", scope.sessionId)
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId);
  if (error) throw new Error(error.message);
}

async function clearSameEmployeeDeviceShiftSessions(
  supabase: ReturnType<typeof createServiceClient>,
  scope: NonNullable<Awaited<ReturnType<typeof readMobileSession>>>,
  shiftId: string,
) {
  const { error } = await supabase
    .from("pos_sessions")
    .update({ shift_id: null })
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("device_code", scope.deviceCode)
    .eq("user_id", scope.userId)
    .eq("shift_id", shiftId);
  if (error) throw new Error(error.message);
}

export async function POST(request: Request) {
  try {
    const scope = await requireActiveMobileSession({ refreshCookie: true });
    if (!scope) return fail("missing_session", "กรุณาเข้าสู่ระบบ", 401);
    if (!["owner", "manager", "staff"].includes(scope.role)) return fail("forbidden", "ไม่มีสิทธิ์เปิดหรือปิดยอด", 403);

    const body = shiftActionSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return fail("invalid_input", "คำสั่งกะไม่ถูกต้อง", 422);
    if (body.data.action === "open" && body.data.openingCash === undefined) return fail("opening_cash_required", "กรุณากรอกเงินทอนเริ่มต้น", 422);
    if (body.data.action === "close" && body.data.closingCash === undefined) return fail("closing_cash_required", "กรุณากรอกเงินสดปิดกะ", 422);

    const supabase = createServiceClient();
    const openShift = await findOpenShift(supabase, scope);

    if (body.data.action === "open") {
      if (openShift) {
        await bindCurrentSessionToShift(supabase, scope, openShift.id);
        await appendMobileAuditLog({
          scope,
          action: "mobile_shift_reused_open",
          targetTable: "shifts",
          targetId: openShift.id,
          metadata: { status: "open", already_open: true, opened_by: openShift.opened_by ?? null },
        });
        return ok({ shiftId: openShift.id, status: "open", alreadyOpen: true, redirectTo: "/sales" });
      }

      const nowIso = new Date().toISOString();
      const openingCash = Number(body.data.openingCash ?? 0);
      const { data, error } = await supabase
        .from("shifts")
        .insert({
          tenant_id: scope.tenantId,
          branch_id: scope.branchId,
          opened_by: scope.userId,
          opened_at: nowIso,
          opening_cash: openingCash,
          expected_cash: openingCash,
          status: "open",
          device_code: scope.deviceCode,
          metadata: { source_app: "CpIPOS Mobile", source_channel: "mobile_web", device_id: scope.deviceId, session_id: scope.sessionId, opening_cash: openingCash },
        })
        .select("id,status,opened_at,opening_cash")
        .single();
      if (error || !data) {
        if (isUniqueViolation(error)) {
          const racedShift = await findOpenShift(supabase, scope);
          if (racedShift) {
            await bindCurrentSessionToShift(supabase, scope, racedShift.id);
            await appendMobileAuditLog({
              scope,
              action: "mobile_shift_reused_raced_open",
              targetTable: "shifts",
              targetId: racedShift.id,
              metadata: { status: "open", already_open: true, raced_open: true },
            });
            return ok({ shiftId: racedShift.id, status: "open", alreadyOpen: true, racedOpen: true, redirectTo: "/sales" });
          }
        }
        throw new Error(error?.message ?? "shift_open_failed");
      }

      await bindCurrentSessionToShift(supabase, scope, data.id);
      await appendMobileAuditLog({
        scope,
        action: "mobile_shift_opened",
        targetTable: "shifts",
        targetId: data.id,
        metadata: { opening_cash: openingCash, status: data.status },
        afterData: { status: data.status ?? "open", opening_cash: openingCash },
      });

      return ok({ shift: data, redirectTo: "/sales" });
    }

    if (!openShift) return fail("shift_not_open", "ยังไม่มีกะที่เปิดอยู่", 409);
    if (scope.role === "staff" && openShift.opened_by && openShift.opened_by !== scope.userId) {
      return fail("shift_close_forbidden", "พนักงานปิดได้เฉพาะกะที่เปิดเอง", 403);
    }

    const { data: activeDineInOrders, error: activeDineInError } = await supabase
      .from("orders")
      .select("id,order_no,status,table_id")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("shift_id", openShift.id)
      .eq("order_type", "dine_in")
      .not("status", "in", "(completed,cancelled)");
    if (activeDineInError) throw new Error(activeDineInError.message);

    const activeDineInRows = (activeDineInOrders ?? []) as ActiveDineInOrderRow[];
    if (activeDineInRows.length > 0) {
      return fail("shift_close_blocked", "ยังมีบิลโต๊ะค้างในกะนี้ กรุณาชำระหรือยกเลิกบิลโต๊ะก่อนปิดยอด", 409);
    }

    const { data: activeTableSessions, error: activeTableSessionError } = await supabase
      .from("table_bill_sessions")
      .select("id,order_id,table_id,metadata")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .in("status", ["open", "ordering", "pending_payment"]);
    if (activeTableSessionError) throw new Error(activeTableSessionError.message);

    const blockingTableSessions = ((activeTableSessions ?? []) as ActiveTableSessionRow[]).filter((session) => session.metadata?.opened_shift_id === openShift.id);
    if (blockingTableSessions.length > 0) {
      return fail("shift_close_blocked", "ยังมีโต๊ะที่เปิดบิลค้างในกะนี้ กรุณาปิดโต๊ะก่อนปิดยอด", 409);
    }

    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id,status,grand_total,total_amount")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("shift_id", openShift.id);
    if (ordersError) throw new Error(ordersError.message);

    const { data: payments, error: paymentsError } = await supabase
      .from("payments")
      .select("method,amount")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("shift_id", openShift.id)
      .eq("status", "paid");
    if (paymentsError) throw new Error(paymentsError.message);

    const summary = {
      order_count: 0,
      cancelled_order_count: 0,
      sales_total: 0,
      cash_total: 0,
      transfer_total: 0,
    };
    for (const order of orders ?? []) {
      if (order.status === "cancelled") {
        summary.cancelled_order_count += 1;
      } else {
        summary.order_count += 1;
        summary.sales_total += toNumber(order.grand_total ?? order.total_amount);
      }
    }
    for (const payment of payments ?? []) {
      if (payment.method === "cash") summary.cash_total += toNumber(payment.amount);
      if (payment.method === "bank_transfer") summary.transfer_total += toNumber(payment.amount);
    }

    const nowIso = new Date().toISOString();
    const closingCash = Number(body.data.closingCash ?? 0);
    const expectedCash = toNumber(openShift.opening_cash) + summary.cash_total;
    const { data, error } = await supabase
      .from("shifts")
      .update({
        status: "closed",
        closed_by: scope.userId,
        closed_at: nowIso,
        expected_cash: expectedCash,
        actual_cash: closingCash,
        closing_cash: closingCash,
        updated_at: nowIso,
        metadata: {
          ...(openShift.metadata ?? {}),
          source_app: "CpIPOS Mobile",
          source_channel: "mobile_web",
          device_id: scope.deviceId,
          session_id: scope.sessionId,
          closing_cash: closingCash,
          expected_cash: expectedCash,
          cash_difference: closingCash - expectedCash,
          summary,
        },
      })
      .eq("id", openShift.id)
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("status", "open")
      .select("id,status,closed_at,expected_cash,actual_cash,closing_cash")
      .single();
    if (error || !data) throw new Error(error?.message ?? "shift_close_failed");

    await clearSameEmployeeDeviceShiftSessions(supabase, scope, openShift.id);
    await appendMobileAuditLog({
      scope,
      action: "mobile_shift_closed",
      targetTable: "shifts",
      targetId: data.id,
      metadata: {
        closing_cash: closingCash,
        expected_cash: expectedCash,
        cash_difference: closingCash - expectedCash,
        summary,
      },
      afterData: { status: data.status ?? "closed", closing_cash: closingCash, expected_cash: expectedCash },
    });

    return ok({ shift: data, summary, redirectTo: "/shifts" });
  } catch (error) {
    console.error("[mobile.shifts]", error);
    return fail("shift_action_error", "ทำรายการกะไม่สำเร็จ กรุณาลองใหม่", 503);
  }
}
