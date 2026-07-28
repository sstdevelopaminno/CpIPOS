import { NextResponse } from "next/server";
import { appendAuditLog } from "@/lib/audit-log";
import { clearShiftOpenBills } from "@/lib/pos-shift-open-bills";
import { resolveShiftCycle } from "@/lib/pos-shift-schedule";
import {
  PosGuardError,
  getTenantBranchScopeFromSession,
  requireActiveShift,
  requirePermission,
  requirePosSessionForShiftClose,
  withPosSessionCookie
} from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

function isMissingSessionShiftColumnError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  const message = String(error.message ?? "").toLowerCase();
  if (message.includes("pos_sessions.shift_id") || message.includes("column shift_id")) return true;
  return message.includes("could not find the 'shift_id' column");
}

function isMissingColumnError(error: { code?: string | null; message?: string | null } | null | undefined, column: string) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "").toLowerCase();
  return code === "42703" || message.includes(`column "${column}"`) || message.includes(`.${column}`) || message.includes("does not exist");
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

const BANGKOK_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

function getBangkokDayEndUtc(dateLike: string) {
  const parsed = new Date(dateLike);
  if (Number.isNaN(parsed.valueOf())) return null;
  const shifted = new Date(parsed.getTime() + BANGKOK_UTC_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  return new Date(Date.UTC(year, month, day, 23, 59, 59, 999) - BANGKOK_UTC_OFFSET_MS);
}

function isWithinWindow(createdAt: string | null | undefined, openedAt: string, endAt: Date) {
  if (!createdAt) return true;
  const created = new Date(createdAt);
  const opened = new Date(openedAt);
  if (Number.isNaN(created.valueOf()) || Number.isNaN(opened.valueOf())) return true;
  return created.getTime() >= opened.getTime() && created.getTime() <= endAt.getTime();
}

function shiftRequiresManagerApproval(openedAt: string) {
  const cycle = resolveShiftCycle(openedAt);
  if (!cycle) return false;
  return Date.now() >= cycle.autoCloseAt.getTime();
}

async function createSelfShiftCloseApproval(args: {
  tenantId: string;
  branchId: string;
  shiftId: string;
  userId: string;
  role: string;
  quickClose: boolean;
}) {
  if (args.role !== "owner" && args.role !== "manager") return null;

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("manager_pin_approvals")
    .insert({
      tenant_id: args.tenantId,
      branch_id: args.branchId,
      action: "shift_close_override",
      requested_by: args.userId,
      approved_by: args.userId,
      target_table: "shifts",
      target_id: args.shiftId,
      note: args.quickClose ? "POS quick close by current manager/owner session." : "POS close by current manager/owner session."
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    throw new Error(error.message);
  }

  return data?.id ?? null;
}

async function getOpenShiftBills(args: { tenantId: string; branchId: string; shiftId: string }) {
  const supabase = getSupabaseServiceClient();
  return supabase
    .from("orders")
    .select("id,order_no,status,order_type,table_id", { count: "exact" })
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("shift_id", args.shiftId)
    .in("status", ["draft", "queued", "preparing"])
    .order("created_at", { ascending: true })
    .limit(5);
}

async function getOpenTableBillSessions(args: { tenantId: string; branchId: string }) {
  const supabase = getSupabaseServiceClient();
  return supabase
    .from("table_bill_sessions")
    .select("id,table_id,status", { count: "exact" })
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .in("status", ["open", "ordering", "pending_payment"])
    .order("opened_at", { ascending: true })
    .limit(5);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      closing_cash?: number | string | null;
      quick_close?: boolean | null;
      clear_open_bills?: boolean | null;
      manager_pin?: string | null;
    } | null;
    const quickClose = body?.quick_close === true;
    const shouldClearOpenBills = body?.clear_open_bills === true;
    const scope = await requirePosSessionForShiftClose();
    requirePermission(scope, "shift:close");
    const { shift } = await requireActiveShift(scope);
    const isStaffRole = scope.session.role !== "owner" && scope.session.role !== "manager" && scope.session.role !== "accountant";

    const sessionScope = getTenantBranchScopeFromSession(scope);
    const overdueAutoClose = shiftRequiresManagerApproval(shift.opened_at);
    if (isStaffRole && shift.opened_by !== scope.session.user_id) {
      return NextResponse.json(
        { data: null, error: { code: "shift_close_forbidden", message: "Staff can close only their own shift." } },
        { status: 403 }
      );
    }
    const closingCashRaw = body?.closing_cash;
    const closingCash =
      closingCashRaw === undefined || closingCashRaw === null || closingCashRaw === ""
        ? null
        : Number(closingCashRaw);
    if (closingCash !== null && (!Number.isFinite(closingCash) || closingCash < 0)) {
      return NextResponse.json(
        { data: null, error: { code: "invalid_closing_cash", message: "closing_cash must be zero or positive." } },
        { status: 422 }
      );
    }

    const supabase = getSupabaseServiceClient();
    if (shouldClearOpenBills) {
      try {
        await clearShiftOpenBills({
          tenantId: sessionScope.tenantId,
          branchId: sessionScope.branchId,
          shiftId: shift.id,
          userId: sessionScope.userId,
          role: sessionScope.role,
          posSessionId: scope.session.id
        });
      } catch (clearError) {
        return NextResponse.json(
          {
            data: null,
            error: {
              code: "shift_clear_open_bills_failed",
              message: clearError instanceof Error ? clearError.message : "Unable to clear open bills."
            }
          },
          { status: 500 }
        );
      }
    }

    const openBills = await getOpenShiftBills({
      tenantId: sessionScope.tenantId,
      branchId: sessionScope.branchId,
      shiftId: shift.id
    });
    if (openBills.error) {
      return NextResponse.json(
        { data: null, error: { code: "shift_open_bills_query_failed", message: openBills.error.message } },
        { status: 500 }
      );
    }
    if ((openBills.count ?? 0) > 0) {
      const sampleBills = (openBills.data ?? [])
        .map((order) => String((order as { order_no?: string | null }).order_no ?? "").trim())
        .filter(Boolean)
        .slice(0, 3);
      const suffix = sampleBills.length > 0 ? ` (${sampleBills.join(", ")})` : "";
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "shift_has_open_bills",
            message: `กรุณาเคลียร์บิลที่ยังเปิดอยู่ ${openBills.count} บิลก่อนปิดกะ${suffix}`
          }
        },
        { status: 409 }
      );
    }

    const openTableSessions = await getOpenTableBillSessions({
      tenantId: sessionScope.tenantId,
      branchId: sessionScope.branchId
    });
    if (openTableSessions.error) {
      return NextResponse.json(
        { data: null, error: { code: "shift_open_tables_query_failed", message: openTableSessions.error.message } },
        { status: 500 }
      );
    }
    if ((openTableSessions.count ?? 0) > 0) {
      return NextResponse.json(
        {
          data: null,
          error: {
            code: "shift_has_open_bills",
            message: `กรุณาปิดหรือชำระบิลโต๊ะที่ยังเปิดอยู่ ${openTableSessions.count} รายการก่อนปิดกะ`
          }
        },
        { status: 409 }
      );
    }

    const closedAtIso = new Date().toISOString();
    const closedByDifferentUser = shift.opened_by !== sessionScope.userId;
    const autoCloseWithoutCashCount = overdueAutoClose && closingCash === null;
    const closeReason = autoCloseWithoutCashCount
      ? "system_auto_close_overdue_shift"
      : closedByDifferentUser
        ? "manager_owner_close_for_staff"
        : "self_close";
    const selfApprovalId = await createSelfShiftCloseApproval({
      tenantId: sessionScope.tenantId,
      branchId: sessionScope.branchId,
      shiftId: shift.id,
      userId: sessionScope.userId,
      role: sessionScope.role,
      quickClose
    });

    const initialExpectedCash = autoCloseWithoutCashCount ? null : closingCash ?? 0;
    const initialActualCash = autoCloseWithoutCashCount ? null : closingCash ?? 0;
    const { error: closeError } = await supabase
      .from("shifts")
      .update({
        status: "closed",
        closed_by: sessionScope.userId,
        closed_at: closedAtIso,
        closing_cash: closingCash,
        expected_cash: initialExpectedCash,
        actual_cash: initialActualCash,
        close_override_approval_id: selfApprovalId,
        metadata: {
          ...(typeof shift === "object" ? { closed_via: "pos_session_gate" } : {}),
          pos_session_id: scope.session.id,
          close_reason: closeReason,
          overdue_auto_close: overdueAutoClose,
          cash_count_required: !autoCloseWithoutCashCount,
          auto_close_uses_sales_total: autoCloseWithoutCashCount,
          manager_approval_required: false,
          manager_approval_removed_reason: overdueAutoClose ? "overdue_shift_can_close_without_manager_pin" : null,
          close_override_approval_id: selfApprovalId,
          self_approved_by_current_session: Boolean(selfApprovalId),
          opened_by_user_id: shift.opened_by,
          closed_by_user_id: sessionScope.userId
        }
      })
      .eq("id", shift.id)
      .eq("tenant_id", sessionScope.tenantId)
      .eq("branch_id", sessionScope.branchId)
      .eq("status", "open");

    if (closeError) {
      const closeMessage = closeError.message.toLowerCase();
      if (closeMessage.includes("override") || closeMessage.includes("unpaid") || closeMessage.includes("mismatch")) {
        return NextResponse.json(
          { data: null, error: { code: "shift_close_blocked", message: closeError.message } },
          { status: 409 }
        );
      }
      return NextResponse.json({ data: null, error: { code: "shift_close_failed", message: closeError.message } }, { status: 500 });
    }

    const sessionShiftClear = await supabase
      .from("pos_sessions")
      .update({ shift_id: null })
      .eq("tenant_id", sessionScope.tenantId)
      .eq("branch_id", sessionScope.branchId)
      .eq("shift_id", shift.id)
      .eq("status", "active");
    if (sessionShiftClear.error && !isMissingSessionShiftColumnError(sessionShiftClear.error)) {
      return NextResponse.json(
        { data: null, error: { code: "session_update_failed", message: sessionShiftClear.error.message } },
        { status: 500 }
      );
    }

    if (quickClose) {
      void appendAuditLog({
        tenantId: sessionScope.tenantId,
        branchId: sessionScope.branchId,
        actorUserId: sessionScope.userId,
        actorRole: sessionScope.role as "owner" | "manager" | "staff" | "accountant",
        action: "pos_shift_closed",
        targetTable: "shifts",
        targetId: shift.id,
        metadata: {
          closing_cash: closingCash,
          pos_session_id: scope.session.id,
          quick_close: true,
          close_reason: closeReason,
          overdue_auto_close: overdueAutoClose,
          cash_count_required: !autoCloseWithoutCashCount,
          auto_close_uses_sales_total: autoCloseWithoutCashCount,
          manager_approval_required: false,
          close_override_approval_id: selfApprovalId,
          self_approved_by_current_session: Boolean(selfApprovalId),
          opened_by_user_id: shift.opened_by,
          closed_by_user_id: sessionScope.userId
        }
      }).catch((auditError) => {
        console.warn("[pos-shifts-close] quick close audit failed", {
          shiftId: shift.id,
          error: auditError instanceof Error ? auditError.message : "Unknown error"
        });
      });

      const response = NextResponse.json({
        data: {
          shift_id: shift.id,
          status: "closed",
          closed_at: closedAtIso,
          quick_close: true
        },
        error: null
      });
      return withPosSessionCookie(response, scope.session.id);
    }

    const openingCashLookup = await supabase
      .from("shifts")
      .select("opening_cash")
      .eq("id", shift.id)
      .eq("tenant_id", sessionScope.tenantId)
      .eq("branch_id", sessionScope.branchId)
      .maybeSingle<{ opening_cash: number | null }>();
    if (openingCashLookup.error) {
      return NextResponse.json(
        { data: null, error: { code: "shift_opening_cash_query_failed", message: openingCashLookup.error.message } },
        { status: 500 }
      );
    }
    const openingCashValue = toNumber(openingCashLookup.data?.opening_cash);

    const summaryCutoffAt = getBangkokDayEndUtc(shift.opened_at);
    const shiftSummaryEndAt =
      summaryCutoffAt && new Date(closedAtIso).getTime() > summaryCutoffAt.getTime()
        ? summaryCutoffAt
        : new Date(closedAtIso);

    const ordersQuery = await supabase
      .from("orders")
      .select("id,shift_id,status,total_amount,grand_total,created_at")
      .eq("tenant_id", sessionScope.tenantId)
      .eq("shift_id", shift.id);
    if (ordersQuery.error) {
      return NextResponse.json(
        { data: null, error: { code: "shift_orders_query_failed", message: ordersQuery.error.message } },
        { status: 500 }
      );
    }

    const orders = (ordersQuery.data ?? []) as Array<{
      id: string;
      shift_id: string | null;
      status: string;
      total_amount: number | null;
      grand_total: number | null;
      created_at: string;
    }>;

    const includedOrderIds = new Set<string>();
    let orderCount = 0;
    let cancelledOrderCount = 0;
    let salesTotal = 0;

    for (const order of orders) {
      if (!isWithinWindow(order.created_at, shift.opened_at, shiftSummaryEndAt)) continue;
      includedOrderIds.add(order.id);
      orderCount += 1;
      if (order.status === "cancelled") {
        cancelledOrderCount += 1;
      } else {
        salesTotal += toNumber(order.grand_total ?? order.total_amount);
      }
    }

    let paymentRows: Array<{ order_id: string | null; shift_id: string | null; method: string; amount: number | null; created_at: string | null }> =
      [];
    const paymentsByShift = await supabase
      .from("payments")
      .select("order_id,shift_id,method,amount,created_at")
      .eq("tenant_id", sessionScope.tenantId)
      .eq("shift_id", shift.id);

    if (paymentsByShift.error && isMissingColumnError(paymentsByShift.error, "shift_id")) {
      const fallbackPayments = await supabase
        .from("payments")
        .select("order_id,method,amount,created_at")
        .eq("tenant_id", sessionScope.tenantId)
        .in("order_id", Array.from(includedOrderIds));
      if (fallbackPayments.error) {
        return NextResponse.json(
          { data: null, error: { code: "shift_payments_query_failed", message: fallbackPayments.error.message } },
          { status: 500 }
        );
      }
      paymentRows = ((fallbackPayments.data ?? []) as Array<{ order_id: string | null; method: string; amount: number | null; created_at: string | null }>).map(
        (row) => ({
          order_id: row.order_id,
          shift_id: shift.id,
          method: row.method,
          amount: row.amount,
          created_at: row.created_at
        })
      );
    } else if (paymentsByShift.error) {
      return NextResponse.json(
        { data: null, error: { code: "shift_payments_query_failed", message: paymentsByShift.error.message } },
        { status: 500 }
      );
    } else {
      paymentRows = (paymentsByShift.data ?? []) as Array<{
        order_id: string | null;
        shift_id: string | null;
        method: string;
        amount: number | null;
        created_at: string | null;
      }>;
    }

    let cashTotal = 0;
    let transferTotal = 0;
    for (const payment of paymentRows) {
      if (payment.order_id && !includedOrderIds.has(payment.order_id)) continue;
      if (!isWithinWindow(payment.created_at, shift.opened_at, shiftSummaryEndAt)) continue;
      if (payment.method === "cash") {
        cashTotal += toNumber(payment.amount);
      } else if (payment.method === "bank_transfer") {
        transferTotal += toNumber(payment.amount);
      }
    }

    const finalExpectedCash = autoCloseWithoutCashCount ? null : Number(cashTotal.toFixed(2));
    const finalActualCash = autoCloseWithoutCashCount ? null : closingCash ?? 0;
    const closeTotalsUpdate = await supabase
      .from("shifts")
      .update({
        expected_cash: finalExpectedCash,
        actual_cash: finalActualCash
      })
      .eq("id", shift.id)
      .eq("tenant_id", sessionScope.tenantId)
      .eq("branch_id", sessionScope.branchId);
    if (closeTotalsUpdate.error) {
      return NextResponse.json(
        { data: null, error: { code: "shift_close_totals_update_failed", message: closeTotalsUpdate.error.message } },
        { status: 500 }
      );
    }

    await appendAuditLog({
      tenantId: sessionScope.tenantId,
      branchId: sessionScope.branchId,
      actorUserId: sessionScope.userId,
      actorRole: sessionScope.role as "owner" | "manager" | "staff" | "accountant",
      action: "pos_shift_closed",
      targetTable: "shifts",
      targetId: shift.id,
      metadata: {
        closing_cash: closingCash,
        pos_session_id: scope.session.id,
        close_reason: closeReason,
        overdue_auto_close: overdueAutoClose,
        cash_count_required: !autoCloseWithoutCashCount,
        auto_close_uses_sales_total: autoCloseWithoutCashCount,
        manager_approval_required: false,
        close_override_approval_id: selfApprovalId,
        self_approved_by_current_session: Boolean(selfApprovalId),
        opened_by_user_id: shift.opened_by,
        closed_by_user_id: sessionScope.userId
      }
    });

    const response = NextResponse.json({
      data: {
        shift_id: shift.id,
        status: "closed",
        closed_at: closedAtIso,
        summary_cutoff_at: shiftSummaryEndAt.toISOString(),
        summary: {
          order_count: orderCount,
          cancelled_order_count: cancelledOrderCount,
          sales_total: salesTotal,
          cash_total: cashTotal,
          transfer_total: transferTotal
        },
        receipt: {
          tenant_name: scope.tenant?.name ?? scope.tenant?.code ?? sessionScope.tenantId,
          branch_name: scope.branch?.name ?? scope.branch?.code ?? sessionScope.branchId,
          branch_code: scope.branch?.code ?? null,
          seller_name: scope.user.full_name ?? sessionScope.userId,
          opened_at: shift.opened_at,
          opening_cash: openingCashValue,
          closing_cash: closingCash ?? 0,
          expected_cash: finalExpectedCash ?? openingCashValue + cashTotal,
          actual_cash: finalActualCash,
          auto_closed_without_cash_count: autoCloseWithoutCashCount
        }
      },
      error: null
    });
    return withPosSessionCookie(response, scope.session.id);
  } catch (error) {
    if (error instanceof PosGuardError) {
      return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return NextResponse.json(
      { data: null, error: { code: "pos_shift_close_failed", message: error instanceof Error ? error.message : "Unknown error." } },
      { status: 500 }
    );
  }
}
