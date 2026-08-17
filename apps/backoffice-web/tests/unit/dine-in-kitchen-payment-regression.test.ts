import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspaceRoot = resolve(process.cwd(), "../..");
const salesModule = readFileSync(resolve(process.cwd(), "src/components/pos/pos-sales-module.tsx"), "utf8");
const commitBoundary = readFileSync(
  resolve(process.cwd(), "src/components/pos/pos-dine-in-commit-reset-boundary.tsx"),
  "utf8"
);
const migration = readFileSync(
  resolve(workspaceRoot, "supabase/migrations/202608170003_fix_dine_in_cancelled_item_quantity.sql"),
  "utf8"
);

describe("dine-in Kitchen + checkout regression contract", () => {
  it("allows zero quantity only for an immutable existing line transitioning to cancelled", () => {
    expect(migration).toContain("new.quantity is null or new.quantity < 0");
    expect(migration).toContain("new.quantity = 0");
    expect(migration).toContain("tg_op <> 'UPDATE'");
    expect(migration).toContain("old.quantity <= 0");
    expect(migration).toContain("new.metadata->>'bill_line_state'");
    expect(migration).toContain("<> 'cancelled'");
    expect(migration).toContain("new.tenant_id is distinct from old.tenant_id");
    expect(migration).toContain("new.branch_id is distinct from old.branch_id");
    expect(migration).toContain("new.order_id is distinct from old.order_id");
    expect(migration).toContain("new.product_id is distinct from old.product_id");
    expect(migration).toContain("new.unit_price is distinct from old.unit_price");
    expect(migration).toContain("new.line_total := 0;");
    expect(migration).toContain("return new;");
  });

  it("keeps the existing payment-review flow behind a successful order submit", () => {
    expect(salesModule).toContain("const createdOrder = await submitOrder(payload);");
    expect(salesModule).toContain("setReviewOrder(");
    expect(salesModule).toContain("checkoutRequestLockRef.current = false;");
  });

  it("keeps the existing dine-in Kitchen auto-send scope and debounce unchanged", () => {
    expect(salesModule).toContain("async function autoSendDineInKitchenOrder()");
    expect(salesModule).toContain("if (orderType !== \"dine_in\"");
    expect(salesModule).toContain("void autoSendDineInKitchenOrder();");
    expect(salesModule).toContain("}, 5000);");
  });

  it("clears committed persistence without remounting the live POS after Kitchen auto-send", () => {
    expect(commitBoundary).toContain("window.localStorage.removeItem(ACTIVE_ORDER_KEY);");
    expect(commitBoundary).not.toContain("setEpoch(");
    expect(commitBoundary).not.toContain("key={epoch}");
    expect(commitBoundary).not.toContain("SKIP_ENTRY_GATE_SPLASH_KEY");
    expect(commitBoundary).toContain("<PosEntryGate lang={lang} />");
  });
});
