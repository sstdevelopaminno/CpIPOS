import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
const route = read("../../src/app/api/pos/orders/[orderId]/item-ingredient-deduct/route.ts");
const migration = read("../../../supabase/migrations/20261107135042_atomic_pos_item_recipe_stock_adjustment.sql");

describe("atomic per-item recipe stock adjustment", () => {
  it("routes all writes through the single transaction RPC", () => {
    expect(route).toContain('supabase.rpc("adjust_pos_item_recipe_stock_tx"');
    expect(route).toContain("idempotency_key_required");
    expect(route).not.toContain('.from("ingredients")\n        .update(');
    expect(route).not.toContain('supabase.from("stock_movements").insert');
  });

  it("serializes retries and rejects reused keys with different payloads", () => {
    expect(migration).toContain("pos_item_ingredient_adjustment_requests");
    expect(migration).toContain("on conflict (tenant_id, branch_id, request_id) do nothing");
    expect(migration).toContain("IDEMPOTENCY_KEY_REUSED");
    expect(migration).toContain("IDEMPOTENCY_RESULT_INCOMPLETE");
  });

  it("locks stock rows before validating and mutating the ledger", () => {
    expect(migration).toContain("order by i.id");
    expect(migration).toContain("for update");
    expect(migration).toContain("INSUFFICIENT_STOCK");
    expect(migration).toContain("RESTORE_EXCEEDS_DEDUCTED");
    expect(migration).toContain("grant execute on function public.adjust_pos_item_recipe_stock_tx");
    expect(migration).toContain("to service_role");
  });
});
