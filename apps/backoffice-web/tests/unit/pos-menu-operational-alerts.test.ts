import { describe, expect, it } from "vitest";
import {
  isActionableQrOrder,
  isAwaitingQrServiceRequest,
  isOutstandingSaleOrder,
  isNewDineInKitchenTicket,
  summarizePosOperationalMenuCounts,
  type PosMenuQrEvent
} from "../../src/lib/pos-menu-operational-alerts";

const liveSessions = new Set(["session-open"]);
const openShifts = new Set(["shift-open"]);
const openTableOrders = new Set(["order-table"]);
const waiter: PosMenuQrEvent = {
  id: "call-1", event_type: "call_staff", review_status: null,
  table_session_id: "session-open", order_id: null
};

describe("POS operational navigation notification counts", () => {
  it("only counts an outstanding sale attached to an open shift or table bill", () => {
    expect(isOutstandingSaleOrder({ id: "old", status: "queued", shift_id: "closed-shift", grand_total: 100, paid_total: 0 }, openShifts, openTableOrders)).toBe(false);
    expect(isOutstandingSaleOrder({ id: "sale-1", status: "queued", shift_id: "shift-open", grand_total: 100, paid_total: 0 }, openShifts, openTableOrders)).toBe(true);
    expect(isOutstandingSaleOrder({ id: "paid", status: "queued", shift_id: "shift-open", grand_total: 100, paid_total: 100 }, openShifts, openTableOrders)).toBe(false);
    expect(isOutstandingSaleOrder({ id: "done", status: "completed", shift_id: "shift-open", grand_total: 100, paid_total: 0 }, openShifts, openTableOrders)).toBe(false);
    expect(isOutstandingSaleOrder({ id: "order-table", status: "queued", grand_total: 100, paid_total: 0 }, openShifts, openTableOrders)).toBe(true);
  });

  it("counts only live QR food submissions still pending explicit POS review", () => {
    const pending = { id: "food-1", event_type: "order", review_status: "pending_pos_review", table_session_id: "session-open", order_id: null };
    expect(isActionableQrOrder(pending, liveSessions)).toBe(true);
    expect(isActionableQrOrder({ ...pending, review_status: "accepted" }, liveSessions)).toBe(false);
    expect(isActionableQrOrder({ ...pending, order_id: "created" }, liveSessions)).toBe(false);
    expect(isActionableQrOrder({ ...pending, table_session_id: "closed" }, liveSessions)).toBe(false);
    expect(isActionableQrOrder({ ...pending, request_id: "foo:kitchen-confirm:bar" }, liveSessions)).toBe(false);
    expect(isActionableQrOrder({ ...pending, payload: { source: "restaurant_qr_pos_review_internal" } }, liveSessions)).toBe(false);
  });

  it("keeps QR waiter and checkout alerts until acknowledged, never counts closed tables", () => {
    expect(isAwaitingQrServiceRequest(waiter, liveSessions)).toBe(true);
    expect(isAwaitingQrServiceRequest({ ...waiter, review_status: "accepted" }, liveSessions)).toBe(false);
    expect(isAwaitingQrServiceRequest({ ...waiter, table_session_id: "closed" }, liveSessions)).toBe(false);
    expect(isAwaitingQrServiceRequest({ ...waiter, event_type: "order" }, liveSessions)).toBe(false);
  });

  it("kitchen badge follows newly queued dine-in tickets and clears after staff receives them", () => {
    const parent = new Map([["order-1", { status: "queued", order_type: "dine_in" }]]);
    const ticket = { id: "kitchen-1", order_id: "order-1", order_type: "dine_in", status: "queued" };
    expect(isNewDineInKitchenTicket(ticket, parent)).toBe(true);
    expect(isNewDineInKitchenTicket({ ...ticket, status: "acknowledged" }, parent)).toBe(false);
    expect(isNewDineInKitchenTicket({ ...ticket, order_type: "takeaway" }, parent)).toBe(false);
    expect(isNewDineInKitchenTicket(ticket, new Map([["order-1", { status: "completed", order_type: "dine_in" }]]))).toBe(false);
  });

  it("counts unique unpaid orders and independent QR/KDS actions without double-counting a shared order", () => {
    const parent = new Map([["order-table", { status: "queued", order_type: "dine_in" }]]);
    const counts = summarizePosOperationalMenuCounts({
      saleOrders: [
        { id: "order-table", status: "queued", shift_id: "shift-open", grand_total: 300, paid_total: 0 },
        { id: "order-table", status: "queued", grand_total: 300, paid_total: 0 },
        { id: "old", status: "queued", shift_id: "shift-closed", grand_total: 500, paid_total: 0 }
      ],
      activeShiftIds: openShifts,
      openTableOrderIds: openTableOrders,
      qrEvents: [
        waiter,
        { id: "checkout-1", event_type: "request_checkout", review_status: null, table_session_id: "session-open" },
        { id: "food-1", event_type: "order", review_status: "pending_pos_review", table_session_id: "session-open", order_id: null }
      ],
      openTableSessionIds: liveSessions,
      kitchenTickets: [
        { id: "kitchen-1", order_id: "order-table", order_type: "dine_in", status: "queued" },
        { id: "kitchen-2", order_id: "order-table", order_type: "dine_in", status: "acknowledged" }
      ],
      kitchenParentOrders: parent
    });
    expect(counts.sales).toEqual({
      pending_sales: 1, pending_qr_orders: 1, staff_calls: 1, checkout_requests: 1, total: 4
    });
    expect(counts.kitchen.new_dine_in_orders).toBe(1);
  });
});
