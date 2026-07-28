import { NextResponse } from "next/server";
import { appendAuditLog } from "@/lib/audit-log";
import { invalidatePosScopeRuntimeCaches } from "@/lib/pos-cache-invalidation";
import {
  PosGuardError,
  getTenantBranchScopeFromSession,
  requireActiveShift,
  requirePermission,
  requirePosSessionForShiftClose
} from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

const BLOCKING_ORDER_STATUSES = ["draft", "queued", "preparing"];
const BLOCKING_TABLE_SESSION_STATUSES = ["open", "ordering", "pending_payment"];
const CLEAR_REASON = "เคลียร์บิลค้างก่อนต่อกะ";

type BlockingOrder = {
  id: string;
  order_no: string | null;
  status: string;
  table_id: string | null;
};

type BlockingTableSession = {
  id: string;
  table_id: string;
  order_id: string | null;
  status: string;
};

function guardErrorResponse(error: unknown) {
  if (error instanceof PosGuardError) {
    return NextResponse.json({ data: null, error: { code: error.code, message: error.message } }, { status: error.status });
  }
  return NextResponse.json(
    {
      data: null,
      error: {
        code: "shift_clear_open_bills_failed",
        message: error instanceof Error ? error.message : "Unable to clear open bills."
      }
    },
    { status: 500 }
  );
}

export async function POST() {
  try {
    const scope = await requirePosSessionForShiftClose();
    requirePermission(scope, "shift:close");
    const { shift } = await requireActiveShift(scope);
    const sessionScope = getTenantBranchScopeFromSession(scope);
    const isStaffRole = scope.session.role !== "owner" && scope.session.role !== "manager" && scope.session.role !== "accountant";

    if (isStaffRole && shift.opened_by !== scope.session.user_id) {
      return NextResponse.json(
        { data: null, error: { code: "shift_clear_open_bills_forbidden", message: "Staff can clear only their own shift bills." } },
        { status: 403 }
      );
    }

    const supabase = getSupabaseServiceClient();
    const { data: orders, error: ordersError } = await supabase
      .from("orders")
      .select("id,order_no,status,table_id")
      .eq("tenant_id", sessionScope.tenantId)
      .eq("branch_id", sessionScope.branchId)
      .eq("shift_id", shift.id)
      .in("status", BLOCKING_ORDER_STATUSES)
      .limit(200);

    if (ordersError) {
      return NextResponse.json(
        { data: null, error: { code: "shift_open_bills_query_failed", message: ordersError.message } },
        { status: 500 }
      );
    }

    const blockingOrders = (orders ?? []) as BlockingOrder[];
    const orderIds = blockingOrders.map((order) => order.id);
    const orderTableIds = blockingOrders.map((order) => order.table_id).filter((id): id is string => Boolean(id));

    let clearedOrderCount = 0;
    if (orderIds.length > 0) {
      const { data: cancelledOrders, error: cancelError } = await supabase
        .from("orders")
        .update({
          status: "cancelled",
          cancelled_by: sessionScope.userId,
          cancelled_reason: CLEAR_REASON
        })
        .eq("tenant_id", sessionScope.tenantId)
        .eq("branch_id", sessionScope.branchId)
        .eq("shift_id", shift.id)
        .in("id", orderIds)
        .in("status", BLOCKING_ORDER_STATUSES)
        .select("id");

      if (cancelError) {
        return NextResponse.json(
          { data: null, error: { code: "shift_clear_orders_failed", message: cancelError.message } },
          { status: 500 }
        );
      }
      clearedOrderCount = cancelledOrders?.length ?? 0;
    }

    const { data: tableSessions, error: tableSessionsError } = await supabase
      .from("table_bill_sessions")
      .select("id,table_id,order_id,status")
      .eq("tenant_id", sessionScope.tenantId)
      .eq("branch_id", sessionScope.branchId)
      .in("status", BLOCKING_TABLE_SESSION_STATUSES)
      .limit(200);

    if (tableSessionsError) {
      return NextResponse.json(
        { data: null, error: { code: "shift_open_tables_query_failed", message: tableSessionsError.message } },
        { status: 500 }
      );
    }

    const blockingTableSessions = (tableSessions ?? []) as BlockingTableSession[];
    const tableSessionIds = blockingTableSessions.map((session) => session.id);
    const tableSessionTableIds = blockingTableSessions.map((session) => session.table_id).filter(Boolean);
    const tableIds = Array.from(new Set([...orderTableIds, ...tableSessionTableIds]));
    const closedAt = new Date().toISOString();

    let clearedTableSessionCount = 0;
    if (tableSessionIds.length > 0) {
      const { data: cancelledSessions, error: cancelSessionError } = await supabase
        .from("table_bill_sessions")
        .update({
          status: "cancelled",
          closed_by: sessionScope.userId,
          closed_at: closedAt
        })
        .eq("tenant_id", sessionScope.tenantId)
        .eq("branch_id", sessionScope.branchId)
        .in("id", tableSessionIds)
        .in("status", BLOCKING_TABLE_SESSION_STATUSES)
        .select("id");

      if (cancelSessionError) {
        return NextResponse.json(
          { data: null, error: { code: "shift_clear_table_sessions_failed", message: cancelSessionError.message } },
          { status: 500 }
        );
      }
      clearedTableSessionCount = cancelledSessions?.length ?? 0;
    }

    if (tableIds.length > 0) {
      const { error: releaseTablesError } = await supabase
        .from("dining_tables")
        .update({ status: "available" })
        .eq("tenant_id", sessionScope.tenantId)
        .eq("branch_id", sessionScope.branchId)
        .in("id", tableIds);

      if (releaseTablesError) {
        return NextResponse.json(
          { data: null, error: { code: "shift_release_tables_failed", message: releaseTablesError.message } },
          { status: 500 }
        );
      }
    }

    void appendAuditLog({
      tenantId: sessionScope.tenantId,
      branchId: sessionScope.branchId,
      actorUserId: sessionScope.userId,
      actorRole: sessionScope.role as "owner" | "manager" | "staff" | "accountant",
      action: "pos_shift_open_bills_cleared",
      targetTable: "shifts",
      targetId: shift.id,
      metadata: {
        pos_session_id: scope.session.id,
        reason: CLEAR_REASON,
        cleared_order_count: clearedOrderCount,
        cleared_table_session_count: clearedTableSessionCount,
        released_table_count: tableIds.length,
        order_ids: orderIds.slice(0, 50),
        order_nos: blockingOrders.map((order) => order.order_no).filter(Boolean).slice(0, 20),
        table_session_ids: tableSessionIds.slice(0, 50)
      }
    });

    invalidatePosScopeRuntimeCaches({ tenantId: sessionScope.tenantId, branchId: sessionScope.branchId });

    return NextResponse.json({
      data: {
        shift_id: shift.id,
        cleared_order_count: clearedOrderCount,
        cleared_table_session_count: clearedTableSessionCount,
        released_table_count: tableIds.length
      },
      error: null
    });
  } catch (error) {
    return guardErrorResponse(error);
  }
}
