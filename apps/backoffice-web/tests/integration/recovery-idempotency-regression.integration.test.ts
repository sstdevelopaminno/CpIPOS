import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const posSalesService = source("../../src/lib/services/pos-sales-service.ts");
const posSalesRoute = source("../../src/app/api/pos/sales/route.ts");
const tableQrOrdering = source("../../src/lib/table-qr-ordering.ts");
const primaryQueueMigration = source("../../../../supabase/migrations/20260818162125_preserve_order_kitchen_queue_across_rounds.sql");
const trialQueueMigration = source("../../../../supabase/trial-data-plane/migrations/20260818162109_trial_preserve_order_kitchen_queue_across_rounds.sql");
const trialPrintLeaseMigration = source("../../../../supabase/migrations/20260818171221_trial_fix_expired_print_lease_status_cast.sql");

describe("POS / QR / payment / print recovery regression guard", () => {
  it("keeps POS order retries idempotent after an ambiguous timeout", () => {
    expect(posSalesService).toContain('.eq("request_id", idempotencyKey)');
    expect(posSalesService).toContain("p_request_id: idempotencyKey ?? null");
    expect(posSalesService).toContain('code: "order_tx_timeout"');
    expect(posSalesService).toContain("Order transaction timed out. Please retry safely with the same request.");
    expect(posSalesService).toContain('action: row.duplicate_request ? "pos_order_replayed" : "pos_order_created"');
  });

  it("keeps payment retries idempotent after an ambiguous timeout", () => {
    expect(posSalesService).toContain('.eq("request_group_id", requestGroupId)');
    expect(posSalesService).toContain("p_request_group_id: requestGroupId ?? null");
    expect(posSalesService).toContain('code: "payment_tx_timeout"');
    expect(posSalesService).toContain("Payment transaction timed out. Please retry safely with the same request.");
    expect(posSalesService).toContain('action: row.duplicate_request ? "pos_payment_replayed" : "pos_payment_completed"');
  });

  it("keeps Table QR requests scoped by request id and retains kitchen print repair", () => {
    expect(tableQrOrdering).toContain('supabase.rpc("submit_table_qr_order_tx"');
    expect(tableQrOrdering).toContain("p_request_id: requestId");
    expect(tableQrOrdering).toContain('.eq("request_id", cleanRequestId)');
    expect(tableQrOrdering).toContain("queueMissingKitchenPrintJobsForOrder");
    expect(tableQrOrdering).toContain("await queueTableQrKitchenPrints({ context, orderId: row.order_id, requestId });");
    expect(posSalesRoute).toContain("queueMissingKitchenPrintJobsForOrder");
    expect(posSalesRoute).toContain("queueKitchenPrintRecoveryForPosOrder");
  });

  it("preserves one kitchen queue number across NEW and ADD rounds on both data planes", () => {
    for (const migration of [primaryQueueMigration, trialQueueMigration]) {
      expect(migration).toContain("v_new text := 'select kt.id, kt.round_no into v_ticket_id, v_round_no'");
      expect(migration).toContain("v_ddl := regexp_replace(v_ddl, v_old, v_new);");
      expect(migration.match(/v_ddl := regexp_replace\(v_ddl, v_old, v_new\);/g) ?? []).toHaveLength(2);
      expect(migration).toContain("if v_after <> v_before - 2 then");
      expect(migration).toContain("queue_select_rewrite_failed");
    }
  });

  it("keeps Trial expired-print-lease recovery compatible with text status", () => {
    expect(trialPrintLeaseMigration).toContain("to_regtype('public.print_job_status') is null");
    expect(trialPrintLeaseMigration).toContain("and data_type = 'text'");
    expect(trialPrintLeaseMigration).toContain("'''retrying''::public.print_job_status'");
    expect(trialPrintLeaseMigration).toContain("'''failed''::public.print_job_status'");
    expect(trialPrintLeaseMigration).toContain("'''retrying'''");
    expect(trialPrintLeaseMigration).toContain("'''failed'''");
    expect(trialPrintLeaseMigration).toContain("TRIAL_PRINT_STATUS_CAST_PATCH_INCOMPLETE");
  });
});
