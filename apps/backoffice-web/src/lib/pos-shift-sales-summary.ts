/**
 * Shared read-only shift reconciliation for history and the close receipt.
 * Payments are linked through orders.shift_id, NOT payments.shift_id: legacy and
 * current POS payment writers commonly leave payments.shift_id null.
 */
export type ShiftSalesOrder = {
  id: string;
  status: string;
  total_amount: number | null;
  grand_total: number | null;
  created_at: string | null;
};

export type ShiftSalesPayment = {
  order_id: string | null;
  method: string;
  amount: number | null;
  created_at: string | null;
  status?: string | null;
};

function money(value: unknown) {
  const result = Number(value ?? 0);
  return Number.isFinite(result) ? result : 0;
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function inShiftWindow(createdAt: string | null, openedAt: string, endAt: Date) {
  if (!createdAt) return true;
  const created = new Date(createdAt);
  const opened = new Date(openedAt);
  if (!Number.isFinite(created.getTime()) || !Number.isFinite(opened.getTime())) return false;
  return created >= opened && created <= endAt;
}

export function calculateShiftSalesSummary(args: {
  orders: ShiftSalesOrder[];
  payments: ShiftSalesPayment[];
  openedAt: string;
  endAt: Date;
}) {
  const summary = {
    order_count: 0,
    cancelled_order_count: 0,
    sales_total: 0,
    cash_total: 0,
    transfer_total: 0
  };
  const paidOrderIds = new Set<string>();
  for (const order of args.orders) {
    if (!inShiftWindow(order.created_at, args.openedAt, args.endAt)) continue;
    summary.order_count += 1;
    if (order.status === "cancelled") {
      summary.cancelled_order_count += 1;
    } else if (order.status === "completed") {
      paidOrderIds.add(order.id);
      summary.sales_total += money(order.grand_total ?? order.total_amount);
    }
  }
  for (const payment of args.payments) {
    // Do not count voided/unpaid orders or unconfirmed payments in the close receipt.
    if (!payment.order_id || !paidOrderIds.has(payment.order_id)) continue;
    if (payment.status !== undefined && payment.status !== "paid") continue;
    if (!inShiftWindow(payment.created_at, args.openedAt, args.endAt)) continue;
    if (payment.method === "cash") summary.cash_total += money(payment.amount);
    if (payment.method === "bank_transfer") summary.transfer_total += money(payment.amount);
  }
  return {
    order_count: summary.order_count,
    cancelled_order_count: summary.cancelled_order_count,
    sales_total: roundMoney(summary.sales_total),
    cash_total: roundMoney(summary.cash_total),
    transfer_total: roundMoney(summary.transfer_total)
  };
}
