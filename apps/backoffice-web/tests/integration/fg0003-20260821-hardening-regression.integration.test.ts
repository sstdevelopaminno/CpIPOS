import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const paymentInvariantMigration = source("../../../../supabase/migrations/20260822020000_pos_payment_financial_invariant.sql");
const printRetryMigration = source("../../../../supabase/migrations/20260822021000_print_agent_durable_retry_backoff.sql");
const productGuardMigration = source("../../../../supabase/migrations/20260822022000_product_active_bill_deactivation_guard.sql");
const customerDisplayNative = source("../../src/components/pos/pos-customer-display-v2-native.tsx");

describe("FG0003 2026-08-21 incident hardening contract", () => {
  it("blocks payment completion when order financial snapshots disagree", () => {
    expect(paymentInvariantMigration).toContain("ORDER_FINANCIAL_INVARIANT_VIOLATION:ITEM_SUBTOTAL_MISMATCH");
    expect(paymentInvariantMigration).toContain("ORDER_FINANCIAL_INVARIANT_VIOLATION:TOTAL_GRAND_MISMATCH");
    expect(paymentInvariantMigration).toContain("ORDER_FINANCIAL_INVARIANT_VIOLATION:GRAND_FORMULA_MISMATCH");
    expect(paymentInvariantMigration).toContain("v_total_due := coalesce(v_grand_total, v_total_amount)");
    expect(paymentInvariantMigration).toContain("for update;");
    expect(paymentInvariantMigration.indexOf("ITEM_SUBTOTAL_MISMATCH")).toBeLessThan(paymentInvariantMigration.indexOf("insert into public.payments"));
  });

  it("spaces transient print retries and gives kitchen jobs a durable recovery horizon", () => {
    expect(printRetryMigration).toContain("case when v_job.printer_role = 'kitchen' then 7");
    expect(printRetryMigration).toContain("case when v_expired.printer_role = 'kitchen' then 7");
    expect(printRetryMigration).toContain("'retry_policy', 'durable_v1'");
    expect(printRetryMigration).toContain("'retry_after_epoch_ms'");
    expect(printRetryMigration).toContain("when v_next_retry = 5 then 300");
    expect(printRetryMigration).toContain("else 600");
  });

  it("prevents catalog deactivation from invalidating an already active bill", () => {
    expect(productGuardMigration).toContain("PRODUCT_IN_USE_BY_ACTIVE_BILL");
    expect(productGuardMigration).toContain("coalesce(oi.quantity, 0) > 0");
    expect(productGuardMigration).toContain("not in ('completed', 'paid', 'closed', 'cleared', 'cancelled')");
    expect(productGuardMigration).toContain("before update of is_active on public.products");
  });

  it("backs off an unauthenticated customer display instead of polling every second forever", () => {
    expect(customerDisplayNative).toContain("const AUTH_BACKOFF_MS = 30_000");
    expect(customerDisplayNative).toContain("const DEVICE_STATE_BACKOFF_MS = 10_000");
    expect(customerDisplayNative).toContain("response.status === 401 || response.status === 403");
    expect(customerDisplayNative).toContain("nextDelayMs = AUTH_BACKOFF_MS");
    expect(customerDisplayNative).not.toContain("window.setInterval(() => void sync(), 1_000)");
  });
});