import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shouldWakeNativePrintAgent } from "@/lib/native-print-wake";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const cancelRoute = source("../../src/app/api/pos/orders/[orderId]/cancel/route.ts");

describe("print latency immediate-wake regression contract", () => {
  it("wakes Android after every POS mutation that can queue physical print work", () => {
    expect(shouldWakeNativePrintAgent("/api/pos/sales", { method: "POST" })).toBe(true);
    expect(shouldWakeNativePrintAgent("/api/pos/payments", { method: "POST" })).toBe(true);
    expect(shouldWakeNativePrintAgent("/api/pos/payment-notice", { method: "POST" })).toBe(true);
    expect(shouldWakeNativePrintAgent("/api/pos/cash-drawer/open", { method: "POST" })).toBe(true);
    expect(shouldWakeNativePrintAgent("/api/pos/receipts/bluetooth", { method: "POST" })).toBe(true);
    expect(shouldWakeNativePrintAgent("/api/pos/orders/order-1/kitchen-dispatch", { method: "POST" })).toBe(true);
    expect(shouldWakeNativePrintAgent("/api/pos/orders/order-1/cancel", { method: "POST" })).toBe(true);
    expect(shouldWakeNativePrintAgent("/api/pos/orders/order-1/pay", { method: "POST" })).toBe(true);
  });

  it("does not add polling wake traffic to reads or unrelated mutations", () => {
    expect(shouldWakeNativePrintAgent("/api/pos/sales", { method: "GET" })).toBe(false);
    expect(shouldWakeNativePrintAgent("/api/pos/tables", { method: "POST" })).toBe(false);
    expect(shouldWakeNativePrintAgent("/api/pos/session/current", { method: "GET" })).toBe(false);
  });

  it("dispatches an idempotent Kitchen CANCEL only when the order had reached Kitchen", () => {
    expect(cancelRoute).toContain('from("kitchen_tickets")');
    expect(cancelRoute).toContain("if (hadKitchenTicket)");
    expect(cancelRoute).toContain("dispatchOrderToKitchen({");
    expect(cancelRoute).toContain('eventKey: `pos_cancel:${orderId}:${cancellationApprovalId}`');
    expect(cancelRoute).toContain('action: "cancel"');
    expect(cancelRoute).toContain("kitchen_cancel_queued_print_job_count");
  });

  it("keeps bill cancellation successful if the physical Kitchen cancellation path has a warning", () => {
    expect(cancelRoute).toContain("kitchenCancelWarning");
    expect(cancelRoute).toContain('action: "pos_order_cancel_kitchen_warning"');
    expect(cancelRoute).toContain("return ok({");
  });
});
