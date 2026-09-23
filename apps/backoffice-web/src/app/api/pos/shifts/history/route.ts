import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { fail, ok } from "@/lib/http";
import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { calculateShiftSalesSummary } from "@/lib/pos-shift-sales-summary";

type ShiftRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  opened_by: string;
  closed_by: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number | null;
  expected_cash: number | null;
  actual_cash: number | null;
  status: string;
  metadata: Record<string, unknown> | null;
};

type OrderRow = {
  id: string;
  shift_id: string | null;
  status: string;
  total_amount: number | null;
  grand_total: number | null;
  created_at: string;
};

type PaymentRow = {
  shift_id: string | null;
  order_id: string | null;
  method: string;
  amount: number | null;
  created_at: string | null;
  status: string | null;
};

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isMissingColumnError(error: { code?: string | null; message?: string | null } | null | undefined, column: string) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "").toLowerCase();
  return code === "42703" || message.includes(`column "${column}"`) || message.includes(`.${column}`) || message.includes("does not exist");
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

function getBangkokDateBoundaryUtc(dateText: string, edge: "start" | "end") {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateText);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hour = edge === "start" ? 0 : 23;
  const minute = edge === "start" ? 0 : 59;
  const second = edge === "start" ? 0 : 59;
  const ms = edge === "start" ? 0 : 999;
  return new Date(Date.UTC(year, month, day, hour, minute, second, ms) - BANGKOK_UTC_OFFSET_MS);
}

function resolveShiftSummaryEndAt(shift: ShiftRow) {
  const bangkokDayEnd = getBangkokDayEndUtc(shift.opened_at);
  if (!bangkokDayEnd) return shift.closed_at ? new Date(shift.closed_at) : null;
  const closedAt = shift.closed_at ? new Date(shift.closed_at) : null;
  if (!closedAt || Number.isNaN(closedAt.valueOf())) return bangkokDayEnd;
  return closedAt.getTime() < bangkokDayEnd.getTime() ? closedAt : bangkokDayEnd;
}

function isWithinShiftSummaryWindow(params: {
  createdAt: string | null | undefined;
  shift: ShiftRow | undefined;
  shiftEndAt: Date | undefined;
}) {
  const { createdAt, shift, shiftEndAt } = params;
  if (!createdAt || !shift || !shiftEndAt) return true;
  const created = new Date(createdAt);
  const opened = new Date(shift.opened_at);
  if (Number.isNaN(created.valueOf()) || Number.isNaN(opened.valueOf())) return true;
  return created.getTime() >= opened.getTime() && created.getTime() <= shiftEndAt.getTime();
}

export async function GET(request: Request) {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "shift:join");
    await requireTenantFeature(scope.session.tenant_id, "attendance_tracking", scope.session.branch_id);
    const role = scope.session.role;
    const canViewBranchWide = role === "owner" || role === "manager";
    if (canViewBranchWide) {
      requirePermission(scope, "reports:view");
    }

    const { searchParams } = new URL(request.url);
    const daysRaw = Number(searchParams.get("days") ?? 30);
    const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(90, Math.trunc(daysRaw))) : 30;
    const startDateRaw = String(searchParams.get("start_date") ?? "").trim();
    const endDateRaw = String(searchParams.get("end_date") ?? "").trim();
    const startDate = startDateRaw ? getBangkokDateBoundaryUtc(startDateRaw, "start") : null;
    const endDate = endDateRaw ? getBangkokDateBoundaryUtc(endDateRaw, "end") : null;
    const view = String(searchParams.get("view") ?? "auto").trim().toLowerCase();
    const selfOnly = canViewBranchWide ? view === "self" : true;
    const branchFilterRaw = String(searchParams.get("branch_id") ?? "all").trim();
    const branchFilter = canViewBranchWide ? branchFilterRaw : scope.session.branch_id;
    const useAllBranches = canViewBranchWide && (!branchFilter || branchFilter === "all");

    const startedAfter = (startDate ?? new Date(Date.now() - days * 24 * 60 * 60 * 1000)).toISOString();
    const supabase = getSupabaseServiceClient();

    const branchOptionsResult = canViewBranchWide
      ? await supabase
          .from("branches")
          .select("id,code,name,is_active")
          .eq("tenant_id", scope.session.tenant_id)
          .eq("is_active", true)
          .order("name", { ascending: true })
      : await supabase
          .from("branches")
          .select("id,code,name,is_active")
          .eq("tenant_id", scope.session.tenant_id)
          .eq("id", scope.session.branch_id)
          .eq("is_active", true)
          .limit(1);

    if (branchOptionsResult.error) {
      return fail("shift_branch_options_query_failed", branchOptionsResult.error.message, 500);
    }

    const branchOptions = ((branchOptionsResult.data ?? []) as Array<{ id: string; code: string | null; name: string | null; is_active: boolean }>)
      .filter((row) => row.is_active)
      .map((row) => ({ id: row.id, code: row.code, name: row.name }));
    const allowedBranchIds = new Set(branchOptions.map((branch) => branch.id));

    if (!useAllBranches && branchFilter && !allowedBranchIds.has(branchFilter)) {
      return fail("branch_filter_forbidden", "Selected branch is not accessible for this user.", 403);
    }

    let shiftsQuery = supabase
      .from("shifts")
      .select("id,tenant_id,branch_id,opened_by,closed_by,opened_at,closed_at,opening_cash,expected_cash,actual_cash,status,metadata")
      .eq("tenant_id", scope.session.tenant_id)
      .gte("opened_at", startedAfter)
      .order("opened_at", { ascending: false })
      .limit(300);
    if (endDate) {
      shiftsQuery = shiftsQuery.lte("opened_at", endDate.toISOString());
    }

    if (!canViewBranchWide || !useAllBranches) {
      const targetBranchId = canViewBranchWide ? branchFilter : scope.session.branch_id;
      if (targetBranchId) {
        shiftsQuery = shiftsQuery.eq("branch_id", targetBranchId);
      }
    }
    if (selfOnly) {
      shiftsQuery = shiftsQuery.eq("opened_by", scope.session.user_id);
    }

    const { data: shiftRows, error: shiftError } = await shiftsQuery;
    if (shiftError) {
      return fail("shift_history_query_failed", shiftError.message, 500);
    }

    const shifts = ((shiftRows ?? []) as ShiftRow[]).map((row) => ({
      ...row,
      opening_cash: toNumber(row.opening_cash),
      expected_cash: row.expected_cash === null ? null : toNumber(row.expected_cash),
      actual_cash: row.actual_cash === null ? null : toNumber(row.actual_cash)
    }));

    if (shifts.length === 0) {
      return ok({
        filters: {
          days,
          self_only: selfOnly,
          can_view_branch_wide: canViewBranchWide,
          selected_branch_id: useAllBranches ? "all" : branchFilter,
          branch_options: branchOptions
        },
        summary: {
          shift_count: 0,
          order_count: 0,
          cancelled_order_count: 0,
          sales_total: 0,
          cash_total: 0,
          transfer_total: 0
        },
        shifts: []
      });
    }

    const shiftIds = shifts.map((shift) => shift.id);
    const shiftMap = new Map<string, ShiftRow>(shifts.map((shift) => [shift.id, shift]));
    const shiftEndAtMap = new Map<string, Date | undefined>(
      shifts.map((shift) => [shift.id, resolveShiftSummaryEndAt(shift) ?? undefined])
    );
    const branchIds = Array.from(new Set(shifts.map((shift) => shift.branch_id).filter((id) => Boolean(id))));
    const userIds = Array.from(new Set(shifts.flatMap((shift) => [shift.opened_by, shift.closed_by]).filter((id): id is string => Boolean(id))));

    const branchResult = branchIds.length
      ? await supabase
          .from("branches")
          .select("id,code,name")
          .in("id", branchIds)
      : { data: [], error: null };

    if (branchResult.error) {
      return fail("shift_branches_query_failed", branchResult.error.message, 500);
    }

    const branchMap = new Map(
      ((branchResult.data ?? []) as Array<{ id: string; code: string | null; name: string | null }>).map((row) => [
        row.id,
        { code: row.code, name: row.name }
      ])
    );
    const usersResult = userIds.length
      ? await supabase.from("users_profiles").select("id,full_name").in("id", userIds)
      : { data: [], error: null };
    if (usersResult.error) {
      return fail("shift_users_query_failed", usersResult.error.message, 500);
    }
    const userMap = new Map(
      ((usersResult.data ?? []) as Array<{ id: string; full_name: string | null }>).map((row) => [
        row.id,
        row.full_name ?? row.id
      ])
    );

    const ordersQuery = await supabase
      .from("orders")
      .select("id,shift_id,status,total_amount,grand_total,created_at")
      .eq("tenant_id", scope.session.tenant_id)
      .in("shift_id", shiftIds);

    if (ordersQuery.error) {
      return fail("shift_orders_query_failed", ordersQuery.error.message, 500);
    }

    const orders = (ordersQuery.data ?? []) as OrderRow[];
    const orderIdToShift = new Map(
      orders.filter((order) => order.shift_id).map((order) => [order.id, order.shift_id as string])
    );
    const orderIdsForPayments = Array.from(orderIdToShift.keys());
    const paymentsByOrder = orderIdsForPayments.length
      ? await supabase
          .from("payments")
          .select("order_id,method,amount,created_at,status")
          .eq("tenant_id", scope.session.tenant_id)
          .in("order_id", orderIdsForPayments)
      : { data: [], error: null };
    if (paymentsByOrder.error) {
      return fail("shift_payments_query_failed", paymentsByOrder.error.message, 500);
    }
    const paymentRows = (paymentsByOrder.data ?? []) as PaymentRow[];
    const ordersByShift = new Map<string, OrderRow[]>();
    const paymentsByShift = new Map<string, PaymentRow[]>();
    for (const order of orders) {
      if (!order.shift_id) continue;
      const items = ordersByShift.get(order.shift_id) ?? [];
      items.push(order);
      ordersByShift.set(order.shift_id, items);
    }
    for (const payment of paymentRows) {
      const shiftId = payment.order_id ? orderIdToShift.get(payment.order_id) : null;
      if (!shiftId) continue;
      const items = paymentsByShift.get(shiftId) ?? [];
      items.push(payment);
      paymentsByShift.set(shiftId, items);
    }

    // Exactly the same reconciliation used by the close response and 58mm receipt.
    const totalsByShift = new Map(
      shifts.map((shift) => [
        shift.id,
        calculateShiftSalesSummary({
          orders: ordersByShift.get(shift.id) ?? [],
          payments: paymentsByShift.get(shift.id) ?? [],
          openedAt: shift.opened_at,
          endAt: shiftEndAtMap.get(shift.id) ?? new Date(shift.closed_at ?? Date.now())
        })
      ])
    );

    const payloadShifts = shifts.map((shift) => {
      const totals = totalsByShift.get(shift.id) ?? {
        order_count: 0,
        cancelled_order_count: 0,
        sales_total: 0,
        cash_total: 0,
        transfer_total: 0
      };
      return {
        ...shift,
        branch_code: branchMap.get(shift.branch_id)?.code ?? null,
        branch_name: branchMap.get(shift.branch_id)?.name ?? null,
        opened_by_name: userMap.get(shift.opened_by) ?? shift.opened_by,
        closed_by_name: shift.closed_by ? userMap.get(shift.closed_by) ?? shift.closed_by : null,
        summary_cutoff_at: (shiftEndAtMap.get(shift.id) ?? null)?.toISOString() ?? null,
        metrics: totals
      };
    });

    const summary = payloadShifts.reduce(
      (acc, shift) => {
        acc.shift_count += 1;
        acc.order_count += shift.metrics.order_count;
        acc.cancelled_order_count += shift.metrics.cancelled_order_count;
        acc.sales_total += shift.metrics.sales_total;
        acc.cash_total += shift.metrics.cash_total;
        acc.transfer_total += shift.metrics.transfer_total;
        return acc;
      },
      {
        shift_count: 0,
        order_count: 0,
        cancelled_order_count: 0,
        sales_total: 0,
        cash_total: 0,
        transfer_total: 0
      }
    );

    return ok({
      filters: {
        days,
        self_only: selfOnly,
        can_view_branch_wide: canViewBranchWide,
        selected_branch_id: useAllBranches ? "all" : branchFilter,
        branch_options: branchOptions
      },
      summary,
      shifts: payloadShifts
    });
  } catch (error) {
    if (error instanceof FeatureGateError) {
      return fail(error.code, error.message, error.status);
    }
    if (error instanceof PosGuardError) {
      return fail(error.code, error.message, error.status);
    }
    return fail("shift_history_failed", error instanceof Error ? error.message : "Unknown error.", 500);
  }
}
