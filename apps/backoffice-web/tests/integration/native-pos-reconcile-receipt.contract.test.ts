import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("Native POS reconcile and receipt history contract", () => {
  it("persists real cash received and change on the paid order", () => {
    const payRoute = source("src/app/api/pos/orders/[orderId]/pay/route.ts");
    expect(payRoute).toContain('const cashReceived = method === "cash" ? round2(amount) : null');
    expect(payRoute).toContain('const changeAmount = method === "cash" ? round2(Math.max(0, amount - dueTotal)) : null');
    expect(payRoute).toContain("payment_completed_at: completedAt");
    expect(payRoute).toContain("payment_completed_by: scope.session.user_id");
    expect(payRoute).toContain("cash_received: cashReceived");
    expect(payRoute).toContain("change_amount: changeAmount");
    expect(payRoute).toContain("change_total: changeAmount ?? 0");
  });

  it("offers a scoped read-only order recovery endpoint without requiring the old shift to remain active", () => {
    const statusRoute = source("src/app/api/pos/orders/[orderId]/status/route.ts");
    expect(statusRoute).toContain("requirePosSession()");
    expect(statusRoute).toContain('requirePermission(scope, "sale:create")');
    expect(statusRoute).toContain('.eq("tenant_id", scope.session.tenant_id)');
    expect(statusRoute).toContain('.eq("branch_id", scope.session.branch_id)');
    expect(statusRoute).toContain("withPosSessionCookie(response, scope.session.id)");
    expect(statusRoute).not.toContain("requireActiveShift");
  });

  it("returns canonical receipt material needed by Android after an uncertain checkout", () => {
    const statusRoute = source("src/app/api/pos/orders/[orderId]/status/route.ts");
    expect(statusRoute).toContain("hydrateOrderItems");
    expect(statusRoute).toContain("hydrateOrderPayments");
    expect(statusRoute).toContain("loadReceiptStoreProfile");
    expect(statusRoute).toContain("cash_received: cashReceived");
    expect(statusRoute).toContain("change_amount: changeAmount");
    expect(statusRoute).toContain("cashier_name:");
  });

  it("keeps existing receipt history search by date and bill number available", () => {
    const receiptsRoute = source("src/app/api/pos/receipts/route.ts");
    expect(receiptsRoute).toContain('const q = searchParams.get("q")?.trim()');
    expect(receiptsRoute).toContain('const status = searchParams.get("status")?.trim() || "completed"');
    expect(receiptsRoute).toContain("const dateWindow = resolveDateWindow(searchParams)");
    expect(receiptsRoute).toContain("cashReceived: Number(row.cash_received ?? 0)");
    expect(receiptsRoute).toContain("changeAmount: Number(row.change_amount ?? 0)");
  });
});
