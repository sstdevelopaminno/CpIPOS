import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workspaceRoot = resolve(process.cwd(), "../..");
const router = readFileSync(resolve(process.cwd(), "src/lib/tenant-data-router.ts"), "utf8");
const paymentLockRoute = readFileSync(
  resolve(process.cwd(), "src/app/api/pos/tables/[tableId]/payment-lock/route.ts"),
  "utf8"
);
const primaryConcurrencyMigration = readFileSync(
  resolve(workspaceRoot, "supabase/migrations/20260818053044_table_order_concurrency_payment_lock_hardening.sql"),
  "utf8"
);
const trialConcurrencyMigration = readFileSync(
  resolve(
    workspaceRoot,
    "supabase/trial-data-plane/migrations/20260818054729_trial_table_order_concurrency_payment_lock_hardening.sql"
  ),
  "utf8"
);
const trialPaymentMigration = readFileSync(
  resolve(
    workspaceRoot,
    "supabase/trial-data-plane/migrations/20260818054924_trial_payment_idempotency_hardening.sql"
  ),
  "utf8"
);

describe("table order concurrency + data-plane routing contract", () => {
  it("routes all table-order payment RPCs through tenant data-plane selection", () => {
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

  it("keeps Primary and Trial payment-lock transactions serialized and fail-closed", () => {
    for (const migration of [primaryConcurrencyMigration, trialConcurrencyMigration]) {
      expect(migration).toContain("set lock_timeout to '5s'");
      expect(migration.toLowerCase()).toContain("for update");
      expect(migration).toContain("set_table_payment_lock_tx");
      expect(migration).toContain("TABLE_SESSION_CLOSED");
      expect(migration.toLowerCase()).toContain("security definer");
      expect(migration.toLowerCase()).toContain("revoke all");
      expect(migration.toLowerCase()).toContain("service_role");
    }
  });

  it("keeps Trial payment retries serialized, runtime-scoped, and fresh-key safe", () => {
    expect(trialPaymentMigration).toContain("set lock_timeout to '5s'");
    expect(trialPaymentMigration.toLowerCase()).toContain("for update");
    expect(trialPaymentMigration).toContain("pg_advisory_xact_lock");
    expect(trialPaymentMigration).toContain("app.require_trial_runtime");
    expect(trialPaymentMigration).toContain("ORDER_ALREADY_PAID");
    expect(trialPaymentMigration.toLowerCase()).toContain("security definer");
    expect(trialPaymentMigration.toLowerCase()).toContain("service_role");
  });
});
