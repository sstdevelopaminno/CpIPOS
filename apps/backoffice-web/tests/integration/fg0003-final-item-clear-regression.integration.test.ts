import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const migration = source("../../../../supabase/migrations/20260822023000_allow_empty_queued_dine_in_replacement.sql");
const clearRoute = source("../../src/app/api/pos/sales/clear-dine-in/route.ts");
const salesUi = source("../../src/components/pos/pos-sales-module.tsx");

describe("FG0003 final dine-in line clearing", () => {
  it("allows only explicit empty desired state while retaining non-empty validation", () => {
    expect(migration).toContain("jsonb_array_length(p_items) > 0 and v_item_count < 1");
    expect(migration).toContain("TABLE_BILL_ORDER_CONFLICT");
    expect(migration).toContain("v_order.status<>'queued'");
    expect(migration).toContain("v_order.order_type<>'dine_in'");
    expect(migration).toContain("'kitchen_delta_kind','cancel'");
  });

  it("clears only the exact queued order bound to the exact live table session", () => {
    expect(clearRoute).toContain('.eq("table_id", tableId)');
    expect(clearRoute).toContain("session.order_id !== orderId");
    expect(clearRoute).toContain('order.status !== "queued"');
    expect(clearRoute).toContain("p_items: []");
    expect(clearRoute).toContain("queueMissingKitchenPrintJobsForOrder");
  });

  it("does not drop an empty cashier desired state after kitchen dispatch", () => {
    expect(salesUi).toContain('fetch("/api/pos/sales/clear-dine-in"');
    expect(salesUi).toContain("cartSnapshot.length === 0 &&");
    expect(salesUi).toContain("job.cart.length === 0 && job.activeOrder?.status === \"queued\"");
    expect(salesUi).not.toContain('shift.status !== "open" || cart.length === 0 || !isOnline) return null;');
    expect(salesUi).not.toContain('if (!job || job.cart.length === 0) return;');
  });
});
