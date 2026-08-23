import "server-only";

import { appendAuditLog } from "@/lib/audit-log";
import { invalidatePosScopeRuntimeCaches } from "@/lib/pos-cache-invalidation";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export const BLOCKING_ORDER_STATUSES = ["draft", "queued", "preparing"];
export const BLOCKING_TABLE_SESSION_STATUSES = ["open", "ordering", "pending_payment"];
export const SHIFT_CLEAR_OPEN_BILLS_REASON = "เคลียร์บิลค้างก่อนต่อกะ";

type BlockingOrder = {
  id: string;
  order_no: string | null;
  status: string;
  table_id: string | null;
  total_amount?: number | string | null;
  grand_total?: number | string | null;
};

type BlockingTableSession = {
  id: string;
  table_id: string;
  order_id: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
};

export type ShiftOpenBillBlocker = {
  order_id: string | null;
  order_no: string | null;
  table_id: string | null;
  table_code: string | null;
  status: string;
  total: number | string | null;
};

export class ShiftOpenBillsBlockedError extends Error {
  code = "shift_has_open_bills" as const;
  blockerCode: "SHIFT_HAS_UNPAID_DINE_IN_ORDERS" | "SHIFT_HAS_ACTIVE_TABLE_BILLS";
  blockers: ShiftOpenBillBlocker[];
  count: number;

  constructor(args: {
    blockerCode: "SHIFT_HAS_UNPAID_DINE_IN_ORDERS" | "SHIFT_HAS_ACTIVE_TABLE_BILLS";
    blockers: ShiftOpenBillBlocker[];
    count?: number;
  }) {
    const count = args.count ?? args.blockers.length;
    super(`${args.blockerCode}:${count}`);
    this.name = "ShiftOpenBillsBlockedError";
    this.blockerCode = args.blockerCode;
    this.blockers = args.blockers;
    this.count = count;
  }
}

export type ClearShiftOpenBillsResult = {
  shift_id: string;
  cleared_order_count: number;
  cleared_table_session_count: number;
  released_table_count: number;
};

function getOrderTotal(order: Pick<BlockingOrder, "grand_total" | "total_amount">) {
  return order.grand_total ?? order.total_amount ?? null;
}

async function getTableCodes(args: { tenantId: string; branchId: string; tableIds: string[] }) {
  const tableIds = Array.from(new Set(args.tableIds.filter(Boolean)));
  if (tableIds.length === 0) return new Map<string, string | null>();

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("dining_tables")
    .select("id,table_code")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .in("id", tableIds);

  if (error) {
    console.warn("[pos-shift-open-bills] blocker table code lookup failed", {
      tenantId: args.tenantId,
      branchId: args.branchId,
      tableCount: tableIds.length,
      error: error.message
    });
    return new Map<string, string | null>();
  }

  return new Map(
    ((data ?? []) as Array<{ id: string; table_code: string | null }>).map((table) => [table.id, table.table_code])
  );
}

export async function getShiftOpenBillBlockers(args: {
  tenantId: string;
  branchId: string;
  shiftId: string;
  limit?: number;
}): Promise<{ count: number; blockers: ShiftOpenBillBlocker[] }> {
  const supabase = getSupabaseServiceClient();
  const { data: orders, error, count } = await supabase
    .from("orders")
    .select("id,order_no,status,table_id,total_amount,grand_total", { count: "exact" })
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("shift_id", args.shiftId)
    .eq("order_type", "dine_in")
    .in("status", BLOCKING_ORDER_STATUSES)
    .order("created_at", { ascending: true })
    .limit(args.limit ?? 200);

  if (error) {
    throw new Error(`shift_open_bills_query_failed: ${error.message}`);
  }

  const blockingOrders = (orders ?? []) as BlockingOrder[];
  const tableCodes = await getTableCodes({
    tenantId: args.tenantId,
    branchId: args.branchId,
    tableIds: blockingOrders.map((order) => order.table_id).filter((tableId): tableId is string => Boolean(tableId))
  });

  return {
    count: count ?? blockingOrders.length,
    blockers: blockingOrders.map((order) => ({
      order_id: order.id,
      order_no: order.order_no,
      table_id: order.table_id,
      table_code: order.table_id ? tableCodes.get(order.table_id) ?? null : null,
      status: order.status,
      total: getOrderTotal(order)
    }))
  };
}

export async function clearShiftOpenBills(args: {
  tenantId: string;
  branchId: string;
  shiftId: string;
  userId: string;
  role: string;
  posSessionId: string;
  reason?: string;
}): Promise<ClearShiftOpenBillsResult> {
  const reason = args.reason ?? SHIFT_CLEAR_OPEN_BILLS_REASON;
  const supabase = getSupabaseServiceClient();

  // A shift cleanup must never be a bill-cancellation mechanism. Any live dine-in
  // order is a hard blocker and must be paid, explicitly cancelled through the
  // normal approved cancellation flow, or transferred by a dedicated handover flow.
  // Takeaway orders are intentionally excluded from this table-bill guard.
  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id,order_no,status,table_id,total_amount,grand_total", { count: "exact" })
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("shift_id", args.shiftId)
    .eq("order_type", "dine_in")
    .in("status", BLOCKING_ORDER_STATUSES)
    .limit(200);

  if (ordersError) {
    throw new Error(`shift_open_bills_query_failed: ${ordersError.message}`);
  }

  const blockingOrders = (orders ?? []) as BlockingOrder[];
  if (blockingOrders.length > 0) {
    const tableCodes = await getTableCodes({
      tenantId: args.tenantId,
      branchId: args.branchId,
      tableIds: blockingOrders.map((order) => order.table_id).filter((tableId): tableId is string => Boolean(tableId))
    });
    throw new ShiftOpenBillsBlockedError({
      blockerCode: "SHIFT_HAS_UNPAID_DINE_IN_ORDERS",
      blockers: blockingOrders.map((order) => ({
        order_id: order.id,
        order_no: order.order_no,
        table_id: order.table_id,
        table_code: order.table_id ? tableCodes.get(order.table_id) ?? null : null,
        status: order.status,
        total: getOrderTotal(order)
      }))
    });
  }

  // A table session belongs to the shift that opened it. Never clear a branch-wide
  // active session while closing/continuing a different shift. This is deliberately
  // fail-closed for legacy sessions that do not carry opened_shift_id.
  const { data: tableSessions, error: tableSessionsError } = await supabase
    .from("table_bill_sessions")
    .select("id,table_id,order_id,status,metadata")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .contains("metadata", { opened_shift_id: args.shiftId })
    .in("status", BLOCKING_TABLE_SESSION_STATUSES)
    .limit(200);

  if (tableSessionsError) {
    throw new Error(`shift_open_tables_query_failed: ${tableSessionsError.message}`);
  }

  const blockingTableSessions = (tableSessions ?? []) as BlockingTableSession[];
  const linkedSessions = blockingTableSessions.filter((session) => Boolean(session.order_id));
  if (linkedSessions.length > 0) {
    const tableCodes = await getTableCodes({
      tenantId: args.tenantId,
      branchId: args.branchId,
      tableIds: linkedSessions.map((session) => session.table_id)
    });
    throw new ShiftOpenBillsBlockedError({
      blockerCode: "SHIFT_HAS_ACTIVE_TABLE_BILLS",
      blockers: linkedSessions.map((session) => ({
        order_id: session.order_id,
        order_no: null,
        table_id: session.table_id,
        table_code: tableCodes.get(session.table_id) ?? null,
        status: session.status,
        total: null
      }))
    });
  }

  // At this point every selected session is proven to belong to the target shift
  // and is empty (order_id = null). Only these empty shells may be cancelled/released.
  const emptyTableSessions = blockingTableSessions.filter((session) => !session.order_id);
  const tableSessionIds = emptyTableSessions.map((session) => session.id);
  const tableIds = Array.from(new Set(emptyTableSessions.map((session) => session.table_id).filter(Boolean)));
  const closedAt = new Date().toISOString();

  let clearedTableSessionCount = 0;
  if (tableSessionIds.length > 0) {
    const { data: cancelledSessions, error: cancelSessionError } = await supabase
      .from("table_bill_sessions")
      .update({
        status: "cancelled",
        closed_by: args.userId,
        closed_at: closedAt
      })
      .eq("tenant_id", args.tenantId)
      .eq("branch_id", args.branchId)
      .contains("metadata", { opened_shift_id: args.shiftId })
      .is("order_id", null)
      .in("id", tableSessionIds)
      .in("status", BLOCKING_TABLE_SESSION_STATUSES)
      .select("id");

    if (cancelSessionError) {
      throw new Error(`shift_clear_table_sessions_failed: ${cancelSessionError.message}`);
    }
    clearedTableSessionCount = cancelledSessions?.length ?? 0;
  }

  if (tableIds.length > 0) {
    const { error: releaseTablesError } = await supabase
      .from("dining_tables")
      .update({ status: "available" })
      .eq("tenant_id", args.tenantId)
      .eq("branch_id", args.branchId)
      .in("id", tableIds);

    if (releaseTablesError) {
      throw new Error(`shift_release_tables_failed: ${releaseTablesError.message}`);
    }
  }

  void appendAuditLog({
    tenantId: args.tenantId,
    branchId: args.branchId,
    actorUserId: args.userId,
    actorRole: args.role as "owner" | "manager" | "staff" | "accountant",
    action: "pos_shift_open_bills_cleared",
    targetTable: "shifts",
    targetId: args.shiftId,
    metadata: {
      pos_session_id: args.posSessionId,
      reason,
      shift_scoped_table_sessions: true,
      shift_scoped_table_release: true,
      only_empty_table_sessions_released: true,
      unpaid_dine_in_orders_cancelled: false,
      cleared_order_count: 0,
      cleared_table_session_count: clearedTableSessionCount,
      released_table_count: tableIds.length,
      table_session_ids: tableSessionIds.slice(0, 50)
    }
  });

  invalidatePosScopeRuntimeCaches({ tenantId: args.tenantId, branchId: args.branchId });

  return {
    shift_id: args.shiftId,
    cleared_order_count: 0,
    cleared_table_session_count: clearedTableSessionCount,
    released_table_count: tableIds.length
  };
}
