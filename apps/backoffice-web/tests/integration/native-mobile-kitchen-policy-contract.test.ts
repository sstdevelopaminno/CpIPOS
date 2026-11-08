import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const policy = read("../../src/app/api/pos/native-mobile/kitchen-policy/route.ts");
const sales = read("../../src/app/api/pos/sales/route.ts");
const routing = read("../../src/lib/services/kitchen-routing-service.ts");

describe("Native mobile kitchen delivery policy contract", () => {
  it("reads only effective branch policy after sale permission and never exposes manager settings", () => {
    expect(policy).toContain('requiredPermission: "sale:create"');
    expect(policy).toContain("requireBranchScope: true");
    expect(policy).toContain("loadTableQrAutomationPolicyForScope");
    expect(policy).toContain("effective_kitchen_auto_send_enabled");
    expect(policy).toContain('"Cache-Control"');
    expect(policy).not.toContain('requiredPermission: "settings:view"');
    expect(policy).not.toContain("service_role");
  });

  it("dispatches configured takeaway to KDS only after the confirmed sale and respects policy", () => {
    const transactionAt = sales.indexOf("const result = await executeCreatePosOrderTransaction");
    const dispatchedAt = sales.indexOf("native-mobile:takeaway:");
    expect(transactionAt).toBeGreaterThan(-1);
    expect(dispatchedAt).toBeGreaterThan(transactionAt);
    expect(sales).toContain('normalizedBody.order_type === "takeaway"');
    expect(sales).toContain("kitchenPolicy.effective.kitchen_auto_send_enabled");
    expect(sales).toContain('eventKey: `native-mobile:takeaway:${createdOrderId}:new`');
    expect(sales).toContain('action: "new"');
    expect(sales).toContain("Native takeaway was committed but kitchen could not be confirmed");
  });

  it("keeps durable sale transactions and server-owned kitchen tickets separate", () => {
    expect(sales).toContain("queueMissingKitchenPrintJobsForOrder");
    expect(routing).toContain("dispatchOrderToKitchen");
    expect(routing).toContain('const action = args.action ?? "new"');
    expect(routing).toContain("repair.ticketCount > 0");
    expect(routing).toContain('supabase.rpc("enqueue_kitchen_order"');
  });
});
