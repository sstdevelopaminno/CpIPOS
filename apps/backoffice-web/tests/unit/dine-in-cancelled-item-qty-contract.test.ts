import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "../..");
const migration = readFileSync(
  resolve(root, "supabase/migrations/202608170003_allow_cancelled_zero_qty_dine_in.sql"),
  "utf8"
);
const salesRoute = readFileSync(resolve(process.cwd(), "src/app/api/pos/sales/route.ts"), "utf8");

describe("dine-in cancelled item quantity contract", () => {
  it("allows only the existing positive-to-zero cancelled update transition", () => {
    expect(migration).toContain("tg_op = 'UPDATE'");
    expect(migration).toContain("new.quantity = 0");
    expect(migration).toContain("old.quantity > 0");
    expect(migration).toContain("new.metadata ->> 'bill_line_state'");
    expect(migration).toContain("= 'cancelled'");
  });

  it("keeps ordinary zero and negative quantities rejected", () => {
    expect(migration).toContain("new.quantity < 0");
    expect(migration).toContain("new.quantity = 0 and not v_is_cancelled_zero_transition");
    expect(migration).toContain("raise exception 'INVALID_ITEM_QTY'");
  });

  it("keeps dine-in queued updates on the existing transactional Kitchen path", () => {
    expect(salesRoute).toContain('rpc("replace_queued_dine_in_order_tx"');
    expect(migration).toContain("new.line_total := round(new.unit_price * new.quantity, 2)");
  });
});
