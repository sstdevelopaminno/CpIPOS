import { isRestaurantQrInternalReviewSource } from "@/lib/restaurant-qr-profile";

export type PosMenuOrder = {
  id: string;
  status: string;
  shift_id?: string | null;
  grand_total?: number | string | null;
  paid_total?: number | string | null;
};

export type PosMenuQrEvent = {
  id: string;
  table_id?: string | null;
  event_type: string | null;
  review_status: string | null;
  table_session_id: string | null;
  order_id?: string | null;
  request_id?: string | null;
  payload?: Record<string, unknown> | null;
};

export type PosMenuKitchenTicket = {
  id: string;
  order_id: string;
  order_type: string;
  status: string;
};

const OPEN_SALE_STATUSES = new Set(["draft", "queued", "preparing"]);
const LIVE_TABLE_STATUSES = new Set(["open", "ordering", "pending_payment"]);
const TERMINAL_ORDER_STATUSES = new Set(["paid", "closed", "cleared", "completed", "cancelled"]);
const DINE_IN_TICKET_TYPES = new Set(["dine_in", "table_qr", "qr_table"]);

export function isLiveTableBill(status: string, closedAt: string | null): boolean {
  return LIVE_TABLE_STATUSES.has(status) && closedAt === null;
}

export function isOutstandingSaleOrder(
  order: PosMenuOrder,
  activeShiftIds: ReadonlySet<string>,
  openTableOrderIds: ReadonlySet<string>
): boolean {
  if (!OPEN_SALE_STATUSES.has(order.status)) return false;
  if (!((order.shift_id && activeShiftIds.has(order.shift_id)) || openTableOrderIds.has(order.id))) return false;
  const total = Number(order.grand_total ?? 0);
  const paid = Number(order.paid_total ?? 0);
  // An unpaid draft may have no calculated amount yet.
  return !Number.isFinite(total) || total <= 0 || paid + 0.005 < total;
}

export function isActionableQrOrder(row: PosMenuQrEvent, openTableSessions: ReadonlySet<string>): boolean {
  return row.event_type === "order" &&
    row.review_status === "pending_pos_review" &&
    row.order_id == null &&
    Boolean(row.table_session_id && openTableSessions.has(row.table_session_id)) &&
    !isRestaurantQrInternalReviewSource(row.payload?.source) &&
    !String(row.request_id ?? "").includes(":kitchen-confirm:");
}

export function isAwaitingQrServiceRequest(
  row: PosMenuQrEvent,
  openTableSessions: ReadonlySet<string>
): boolean {
  // The existing POS-wide QR alert uses payload.acknowledged_at as its
  // canonical receipt marker, not the food-order review_status.
  const acknowledgedAt = row.payload?.acknowledged_at;
  const alreadyAcknowledged = typeof acknowledgedAt === "string" && acknowledgedAt.trim().length > 0;
  return (row.event_type === "call_staff" || row.event_type === "request_checkout") &&
    !alreadyAcknowledged &&
    Boolean(row.table_session_id && openTableSessions.has(row.table_session_id));
}

export function isNewDineInKitchenTicket(
  ticket: PosMenuKitchenTicket,
  parentOrders: ReadonlyMap<string, { status: string; order_type: string }>
): boolean {
  if (ticket.status !== "queued" || !DINE_IN_TICKET_TYPES.has(ticket.order_type)) return false;
  const parent = parentOrders.get(ticket.order_id);
  return Boolean(parent && !TERMINAL_ORDER_STATUSES.has(parent.status));
}

export type PosOperationalMenuCounts = {
  sales: { pending_sales: number; pending_qr_orders: number; staff_calls: number; checkout_requests: number; total: number };
  kitchen: { new_dine_in_orders: number };
  pending_service_requests?: Array<{ id: string; table_id: string; table_code: string; type: "call_staff" | "request_checkout" }>;
};

export const EMPTY_POS_MENU_ALERT_COUNTS: PosOperationalMenuCounts = {
  sales: { pending_sales: 0, pending_qr_orders: 0, staff_calls: 0, checkout_requests: 0, total: 0 },
  kitchen: { new_dine_in_orders: 0 }
};

export function summarizePosOperationalMenuCounts(args: {
  saleOrders: readonly PosMenuOrder[];
  activeShiftIds: ReadonlySet<string>;
  openTableOrderIds: ReadonlySet<string>;
  qrEvents: readonly PosMenuQrEvent[];
  openTableSessionIds: ReadonlySet<string>;
  qrReviewSessionIds: ReadonlySet<string>;
  kitchenTickets: readonly PosMenuKitchenTicket[];
  kitchenParentOrders: ReadonlyMap<string, { status: string; order_type: string }>;
}): PosOperationalMenuCounts {
  const pendingSales = new Set(args.saleOrders
    .filter((row) => isOutstandingSaleOrder(row, args.activeShiftIds, args.openTableOrderIds))
    .map((row) => row.id)).size;
  const pendingQrOrders = args.qrEvents.filter((row) => isActionableQrOrder(row, args.qrReviewSessionIds)).length;
  const staffCalls = args.qrEvents.filter((row) => row.event_type === "call_staff" &&
    isAwaitingQrServiceRequest(row, args.openTableSessionIds)).length;
  const checkoutRequests = args.qrEvents.filter((row) => row.event_type === "request_checkout" &&
    isAwaitingQrServiceRequest(row, args.openTableSessionIds)).length;
  const kitchenOrders = args.kitchenTickets.filter((row) => isNewDineInKitchenTicket(row, args.kitchenParentOrders)).length;
  return {
    sales: {
      pending_sales: pendingSales,
      pending_qr_orders: pendingQrOrders,
      staff_calls: staffCalls,
      checkout_requests: checkoutRequests,
      total: pendingSales + pendingQrOrders + staffCalls + checkoutRequests
    },
    kitchen: { new_dine_in_orders: kitchenOrders }
  };
}
