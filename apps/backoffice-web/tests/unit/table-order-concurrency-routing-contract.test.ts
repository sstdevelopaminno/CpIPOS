import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspaceRoot = resolve(process.cwd(), "../..");
const router = readFileSync(resolve(process.cwd(), "src/lib/tenant-data-router.ts"), "utf8");
const paymentLockRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/pos/tables/[tableId]/payment-lock/route.ts"),
  "utf8"
);
const primaryMigration = readFileSync(
  resolve(workspaceRoot, "supabase/migrations/20260818053044_table_order_concurrency_payment_lock_hardening.sql"),
  "utf8"
);

describe("table order concurrency + data-plane routing contract", () => {
  it("routes the table payment lock RPC through tenant data-plane selection", () => {
    const rpcBlock = router.slice(router.indexOf("const BUSINESS_RPCS"), router.indexOf("const MUTATION_METHODS"));
    expect(rpcBlock).toContain('"submit_table_qr_order_tx"');
    expect(rpcBlock).toContain('"set_table_payment_lock_tx"');
    expect(rpcBlock).toContain('"complete_pos_payment_tx"');
  });

  it("keeps payment lock requests explicitly scoped to tenant, branch, table, and order", () => {
    expect(paymentLockRoute).toContain('supabase.rpc("set_table_payment_lock_tx"');
    expect(paymentLockRoute).toContain("p_tenant_id: auth.tenantId!");
    expect(paymentLockRoute).toContain("p_branch_id: auth.branchId!");
    expect(paymentLockRoute).toContain("p_table_id: tableId");
    expect(paymentLockRoute).toContain("p_order_id: orderId");
    expect(paymentLockRoute).toContain('code === "55P03"');
    expect(paymentLockRoute).toContain('code === "40P01"');
    expect(paymentLockRoute).toContain('fail("table_payment_lock_busy"');
  });

  it("keeps the production payment-lock transaction serialized and fail-closed", () => {
    expect(primaryMigration).toContain("set lock_timeout to '5s'");
    expect(primaryMigration.toLowerCase()).toContain("for update");
    expect(primaryMigration).toContain("set_table_payment_lock_tx");
    expect(primaryMigration.toLowerCase()).toContain("security definer");
    expect(primaryMigration.toLowerCase()).toContain("revoke all");
    expect(primaryMigration.toLowerCase()).toContain("service_role");
  });
});
