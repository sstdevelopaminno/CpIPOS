import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const tableQrMobile = source("../../src/components/table-order/table-order-mobile.tsx");
const tableQrRoute = source("../../src/app/api/table-order/[token]/route.ts");
const tableQrOrdering = source("../../src/lib/table-qr-ordering.ts");
const posSalesModule = source("../../src/components/pos/pos-sales-module.tsx");
const migration = source("../../../../supabase/migrations/20260822025619_table_qr_payload_dedupe_and_pos_table_autosend.sql");
const trialMigration = source("../../../../supabase/trial-data-plane/migrations/20260822025619_trial_table_qr_payload_dedupe_and_pos_table_autosend.sql");

describe("FG0003 table QR duplicate submit and POS table auto-send regression", () => {
  it("deduplicates fast QR double-submit by stable client id and payload fingerprint", () => {
    expect(tableQrMobile).toContain("function buildSubmitFingerprint(items: SubmitItem[])");
    expect(tableQrMobile).toContain("submitInFlightRef.current?.fingerprint === fingerprint");
    expect(tableQrMobile).toContain('"x-table-order-client-id"');
    expect(tableQrRoute).toContain("const clientId = getTableOrderClientId(request)");
    expect(tableQrRoute).toContain("submitTableQrOrder({ context: qrContext, requestId, items");
    expect(tableQrRoute).toContain("clientId");
    expect(tableQrOrdering).toContain("TABLE_QR_RECENT_DUPLICATE_WINDOW_MS = 15_000");
    expect(tableQrOrdering).toContain("buildQrOrderPayloadFingerprint");
    expect(tableQrOrdering).toContain("loadRecentQrOrderPayloadDuplicate");
    expect(tableQrOrdering).toContain("payload_fingerprint");
    expect(tableQrOrdering).toContain("duplicateRequest: true");
  });

  it("keeps POS dine-in kitchen auto-send alive after staff switches tables", () => {
    expect(posSalesModule).toContain("type DineInAutoSendJob");
    expect(posSalesModule).toContain("dineInAutoSendTimersRef");
    expect(posSalesModule).toContain("dineInAutoSendJobsRef");
    expect(posSalesModule).toContain("scheduleDineInKitchenAutoSend(job");
    expect(posSalesModule).toContain("void runDineInKitchenAutoSend(tableId)");
    expect(posSalesModule).toContain("DINE_IN_KITCHEN_AUTO_SEND_DELAY_MS = 1200");
    expect(posSalesModule).toContain("dineInKitchenSendingNotice");
    expect(posSalesModule).toContain('role="status"');
    expect(posSalesModule).not.toContain("dineInAutoSendTimerRef");
    expect(posSalesModule).not.toContain("window.clearTimeout(dineInAutoSendTimerRef.current)");
  });

  it("indexes the QR duplicate lookup on Primary and Trial data planes", () => {
    expect(migration).toContain("idx_table_qr_orders_qr_session_event_created");
    expect(migration).toContain("idx_table_qr_orders_qr_session_payload_fingerprint");
    expect(migration).toContain("payload->>'client_id'");
    expect(migration).toContain("payload->>'payload_fingerprint'");
    expect(trialMigration).toContain("Trial mirror");
    expect(trialMigration).toContain("idx_trial_table_qr_orders_qr_session_payload_fingerprint");
  });
});