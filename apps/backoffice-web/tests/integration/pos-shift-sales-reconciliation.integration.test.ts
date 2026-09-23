import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { calculateShiftSalesSummary, type ShiftSalesOrder, type ShiftSalesPayment } from "@/lib/pos-shift-sales-summary";

const openedAt = "2026-09-23T11:00:00.000Z";
const endAt = new Date("2026-09-23T13:30:00.000Z");
const order = (id: string, amount: number, status = "completed"): ShiftSalesOrder => ({
  id, status, grand_total: amount, total_amount: amount, created_at: openedAt
});
const payment = (order_id: string, amount: number, method = "bank_transfer", status = "paid"): ShiftSalesPayment => ({
  order_id, amount, method, status, created_at: openedAt
});

describe("POS shift sales close/history reconciliation", () => {
  it("reproduces the real 6-bill 1,273 THB transfer-only close with null payment.shift_id", () => {
    const values = [200, 200, 200, 200, 200, 273];
    const orders = values.map((value, i) => order(`bill-${i}`, value));
    const payments = values.map((value, i) => payment(`bill-${i}`, value));
    expect(calculateShiftSalesSummary({ orders, payments, openedAt, endAt })).toEqual({
      order_count: 6, cancelled_order_count: 0,
      sales_total: 1273, cash_total: 0, transfer_total: 1273
    });
  });

  it("uses payment lines for split tender and excludes cancelled/unpaid payments", () => {
    const orders = [
      order("paid-1", 500), order("paid-2", 773),
      order("void", 400, "cancelled"), order("draft", 999, "draft")
    ];
    const payments = [
      payment("paid-1", 200, "cash"), payment("paid-1", 300),
      payment("paid-2", 773),
      payment("void", 400, "cash"), payment("draft", 999, "cash"),
      payment("paid-2", 500, "cash", "pending")
    ];
    expect(calculateShiftSalesSummary({ orders, payments, openedAt, endAt })).toEqual({
      order_count: 4, cancelled_order_count: 1,
      sales_total: 1273, cash_total: 200, transfer_total: 1073
    });
  });

  it("keeps payments outside the shift reporting cutoff out of the receipt", () => {
    const orders = [order("bill", 1273)];
    const payments = [{ ...payment("bill", 1273), created_at: "2026-09-23T14:00:00.000Z" }];
    expect(calculateShiftSalesSummary({ orders, payments, openedAt, endAt })).toMatchObject({
      sales_total: 1273, cash_total: 0, transfer_total: 0
    });
  });

  it("binds close payments by order ID and preserves the opening float in drawer expectation", () => {
    const source = readFileSync(new URL("../../src/app/api/pos/shifts/close/route.ts", import.meta.url), "utf8");
    const history = readFileSync(new URL("../../src/app/api/pos/shifts/history/route.ts", import.meta.url), "utf8");
    expect(source).toContain('.in("order_id", orderIds)');
    expect(source).toContain("calculateShiftSalesSummary({");
    expect(history).toContain("calculateShiftSalesSummary({");
    expect(source).toContain("openingCashValue + cashTotal");
    expect(source).not.toContain("paymentsByShift");
  });
});
