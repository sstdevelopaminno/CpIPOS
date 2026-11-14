import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import {
  EMPTY_POS_MENU_ALERT_COUNTS,
  isLiveTableBill,
  summarizePosOperationalMenuCounts,
  type PosMenuKitchenTicket,
  type PosMenuOrder,
  type PosMenuQrEvent,
  type PosOperationalMenuCounts
} from "@/lib/pos-menu-operational-alerts";

type ScopedRow = { id: string };
type TableSessionRow = { id: string; order_id: string | null; status: string; closed_at: string | null };
type ParentOrderRow = { id: string; status: string; order_type: string };

export async function loadPosOperationalMenuCounts(args: {
  tenantId: string;
  branchId: string;
  includeSales: boolean;
}): Promise<PosOperationalMenuCounts> {
  const db = getSupabaseServiceClient();
  const { tenantId, branchId, includeSales } = args;
  // Only current/suspended shifts and open table bills are actionable. Old
  // queued orders from closed shifts must not flood the navigation badge.
  const [shiftResult, tableResult, ticketResult] = await Promise.all([
    includeSales
      ? db.from("shifts").select("id").eq("tenant_id", tenantId).eq("branch_id", branchId)
        .in("status", ["open", "suspended"]).limit(100)
      : Promise.resolve({ data: [] as ScopedRow[], error: null }),
    includeSales
      ? db.from("table_bill_sessions").select("id,order_id,status,closed_at")
        .eq("tenant_id", tenantId).eq("branch_id", branchId)
        .in("status", ["open", "ordering", "pending_payment"])
        .is("closed_at", null).limit(400)
      : Promise.resolve({ data: [] as TableSessionRow[], error: null }),
    db.from("kitchen_tickets").select("id,order_id,order_type,status")
      .eq("tenant_id", tenantId).eq("branch_id", branchId)
      .eq("status", "queued")
      .in("order_type", ["dine_in", "table_qr", "qr_table"])
      .order("created_at", { ascending: false }).limit(500)
  ]);
  if (shiftResult.error || tableResult.error || ticketResult.error) {
    throw new Error("pos_menu_alert_scoped_query_failed");
  }

  const shifts = (shiftResult.data ?? []) as ScopedRow[];
  const sessions = ((tableResult.data ?? []) as TableSessionRow[])
    .filter((row) => isLiveTableBill(row.status, row.closed_at));
  const kitchenTickets = (ticketResult.data ?? []) as PosMenuKitchenTicket[];
  const activeShiftIds = new Set(shifts.map((row) => row.id));
  const openTableSessionIds = new Set(sessions.map((row) => row.id));
  const openTableOrderIds = new Set(sessions.map((row) => row.order_id).filter((id): id is string => Boolean(id)));
  const kitchenOrderIds = Array.from(new Set(kitchenTickets.map((row) => row.order_id).filter(Boolean)));

  const [shiftOrders, tableOrders, qrOrders, kitchenParents] = await Promise.all([
    includeSales && activeShiftIds.size > 0
      ? db.from("orders").select("id,status,shift_id,grand_total,paid_total")
        .eq("tenant_id", tenantId).eq("branch_id", branchId)
        .in("shift_id", [...activeShiftIds]).in("status", ["draft", "queued", "preparing"])
        .order("created_at", { ascending: false }).limit(500)
      : Promise.resolve({ data: [] as PosMenuOrder[], error: null }),
    includeSales && openTableOrderIds.size > 0
      ? db.from("orders").select("id,status,shift_id,grand_total,paid_total")
        .eq("tenant_id", tenantId).eq("branch_id", branchId)
        .in("id", [...openTableOrderIds]).in("status", ["draft", "queued", "preparing"]).limit(400)
      : Promise.resolve({ data: [] as PosMenuOrder[], error: null }),
    includeSales && openTableSessionIds.size > 0
      ? db.from("table_qr_orders")
        .select("id,event_type,review_status,table_session_id,order_id,request_id,payload")
        .eq("tenant_id", tenantId).eq("branch_id", branchId)
        .in("table_session_id", [...openTableSessionIds])
        .in("event_type", ["order", "call_staff", "request_checkout"])
        .or("review_status.eq.pending_pos_review,review_status.is.null")
        .order("created_at", { ascending: false }).limit(500)
      : Promise.resolve({ data: [] as PosMenuQrEvent[], error: null }),
    kitchenOrderIds.length
      ? db.from("orders").select("id,status,order_type").eq("tenant_id", tenantId)
        .eq("branch_id", branchId).in("id", kitchenOrderIds).limit(500)
      : Promise.resolve({ data: [] as ParentOrderRow[], error: null })
  ]);
  if (shiftOrders.error || tableOrders.error || qrOrders.error || kitchenParents.error) {
    throw new Error("pos_menu_alert_details_failed");
  }
  const kitchenParentOrders = new Map(
    ((kitchenParents.data ?? []) as ParentOrderRow[])
      .map((row) => [row.id, { status: row.status, order_type: row.order_type }] as const)
  );
  if (!includeSales && !kitchenTickets.length) return EMPTY_POS_MENU_ALERT_COUNTS;
  return summarizePosOperationalMenuCounts({
    saleOrders: [...((shiftOrders.data ?? []) as PosMenuOrder[]), ...((tableOrders.data ?? []) as PosMenuOrder[])],
    activeShiftIds, openTableOrderIds,
    qrEvents: (qrOrders.data ?? []) as PosMenuQrEvent[],
    openTableSessionIds, kitchenTickets, kitchenParentOrders
  });
}
