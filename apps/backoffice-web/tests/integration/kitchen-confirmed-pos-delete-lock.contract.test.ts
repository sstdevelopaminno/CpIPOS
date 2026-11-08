import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const src = (path: string) => readFileSync(resolve(root, path), "utf8");
const migration = src("supabase/migrations/20261108172800_kitchen_confirmed_pos_delete_lock.sql");
const trial = src("supabase/trial-data-plane/migrations/20261108172800_trial_kitchen_confirmed_pos_delete_lock.sql");
const sales = src("apps/backoffice-web/src/app/api/pos/sales/route.ts");
const clear = src("apps/backoffice-web/src/app/api/pos/sales/clear-dine-in/route.ts");
const cancel = src("apps/backoffice-web/src/app/api/pos/orders/[orderId]/cancel/route.ts");
const kds = src("apps/backoffice-web/src/lib/services/kitchen-queue-service.ts");
const service = src("apps/backoffice-web/src/lib/services/kitchen-conditions-service.ts");
const route = src("apps/backoffice-web/src/app/api/pos/settings/kitchen-conditions/route.ts");
const portal = src("apps/backoffice-web/src/components/pos-preview/table-qr-settings-menu-portal.tsx");

describe("POS lock after kitchen acknowledgement", () => {
  it("defaults to protected and limits the toggle to owner/manager", () => {
    expect(migration).toContain("kitchen_confirmed_pos_delete_lock_enabled boolean NOT NULL DEFAULT true");
    expect(service).toContain('getPrimarySupabaseServiceClient()');
    expect(service).toContain('auth.branchRole !== "owner"');
    expect(service).toContain('auth.branchRole !== "manager"');
    expect(route).toContain('requiredPermission: "settings:view"');
    expect(portal).toContain('href="/preview/pos/settings/kitchen-conditions"');
  });

  it("enforces the same guarded RPC for edits, clear and cancellation", () => {
    expect(sales).toContain('supabase.rpc("replace_queued_dine_in_order_pos_guarded_tx"');
    expect(clear).toContain('supabase.rpc("replace_queued_dine_in_order_pos_guarded_tx"');
    expect(cancel).toContain('supabase.rpc("cancel_queued_pos_order_kitchen_guarded_tx"');
    expect(sales).toContain("KITCHEN_CONFIRMED_ITEM_LOCKED");
    expect(clear).toContain("KITCHEN_CONFIRMED_ITEM_LOCKED");
    expect(cancel).toContain("KITCHEN_CONFIRMED_ITEM_LOCKED");
    expect(migration).toContain("p_lock_confirmed_items boolean DEFAULT true");
    expect(trial).toContain("app.replace_queued_dine_in_order_pos_guarded_tx");
  });

  it("checks confirmed item quantities, not simply whether an order has been dispatched", () => {
    expect(migration).toContain("SELECT DISTINCT oi.id");
    expect(migration).toContain("SUM(quantity) AS min_quantity");
    expect(migration).toContain("COALESCE(d.quantity, 0) < c.min_quantity");
    expect(migration).toContain("('acknowledged', 'preparing', 'ready')");
    expect(migration).toContain("kds_line_cancelled");
    expect(migration).toContain("KITCHEN_CONFIRMED_ITEM_LOCKED");
  });

  it("does not disable the existing kitchen-side cancellation API", () => {
    expect(kds).toContain('supabase.rpc("replace_queued_dine_in_order_tx"');
    expect(kds).not.toContain("replace_queued_dine_in_order_pos_guarded_tx");
  });
});
