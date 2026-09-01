import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const restaurantQrProfile = readFileSync(new URL("../../src/lib/restaurant-qr-profile.ts", import.meta.url), "utf8");
const compatibilityAlias = readFileSync(new URL("../../src/lib/fg0003-qr-kitchen-hardening.ts", import.meta.url), "utf8");
const qrOrdering = readFileSync(new URL("../../src/lib/table-qr-ordering.ts", import.meta.url), "utf8");
const posSales = readFileSync(new URL("../../src/components/pos/pos-sales-module.tsx", import.meta.url), "utf8");
const salesModePreferenceEnhancer = readFileSync(new URL("../../src/components/pos/pos-sales-mode-preference-enhancer.tsx", import.meta.url), "utf8");
const tableQrRoute = readFileSync(new URL("../../src/app/api/pos/tables/[tableId]/qr-orders/route.ts", import.meta.url), "utf8");
const activityRoute = readFileSync(new URL("../../src/app/api/pos/table-qr-activity/route.ts", import.meta.url), "utf8");
const printService = readFileSync(new URL("../../src/lib/printing/print-service.ts", import.meta.url), "utf8");
const routedPrintService = readFileSync(new URL("../../src/lib/printing/routed-print-service.ts", import.meta.url), "utf8");
const primaryMigration = readFileSync(new URL("../../../../supabase/migrations/202608240002_fg0003_cancelled_order_print_claim_guard.sql", import.meta.url), "utf8");
const trialMigration = readFileSync(new URL("../../../../supabase/trial-data-plane/migrations/202608240002_trial_fg0003_cancelled_order_print_claim_guard.sql", import.meta.url), "utf8");

describe("Restaurant QR exactly-once hardening contracts", () => {
  it("keeps Restaurant QR activation centralized and FG0003 backward compatible", () => {
    expect(restaurantQrProfile).toContain("RESTAURANT_QR_PRODUCT_PROFILE");
    expect(restaurantQrProfile).not.toContain("RESTAURANT_QR_ENABLED_SCOPES");
    expect(restaurantQrProfile).toContain('tenantCode.startsWith("FG")');
    expect(restaurantQrProfile).toContain("fg0003_pos_review_internal");
    expect(compatibilityAlias).toContain("isRestaurantQrScope as isFg0003QrKitchenScope");
  });

  it("filters POS QR review polling to one actionable parent order", () => {
    for (const route of [tableQrRoute, activityRoute]) {
      expect(route).toContain("ACTIVE_QR_REVIEW_TABLE_SESSION_STATUSES");
      expect(route).toContain("table_bill_sessions");
      expect(route).toContain('row.order_id === null');
      expect(route).toContain("isRestaurantQrInternalReviewSource(payload.source)");
      expect(route).toContain(":kitchen-confirm:");
      expect(route).toContain("request_id");
      expect(route.includes(".limit(8)") || route.includes(".limit(restaurantQrPendingOnly ? 8 : 25)")).toBe(true);
      expect(route).toContain(".slice(0, 1)");
    }
  });

  it("makes POS review terminal-aware and deterministic under repeated popups", () => {
    expect(posSales).toContain("tableQrReviewQueue");
    expect(posSales).toContain("tableQrReviewTerminalRef");
    expect(posSales).toContain("tableQrReviewSubmitInFlightRef");
    expect(posSales).toContain("tableQrOrderAbortRef");
    expect(posSales).toContain("new AbortController()");
    expect(posSales).toContain("isSuppressedTableQrReviewId(entry.id)");
    expect(posSales).toContain('reviewStatus !== "pending_pos_review"');
    expect(posSales).toContain('request_id: `pos-qr-review-${review.submissionId}-${action}`');
    expect(posSales).toContain("tableQrReviewSubmitInFlightRef.current.add(review.submissionId)");
    expect(posSales).toContain("tableQrOrderSeenRef.current.add(review.submissionId)");
    expect(posSales).toContain("setTableQrAlert((current) => (current?.id === review.submissionId ? null : current))");
    expect(posSales).toContain("tableQrOrderAbortRef.current?.abort()");
    expect(posSales).toContain("tableQrReviewSubmitInFlightRef.current.delete(review.submissionId)");
    expect(posSales).toContain("fetchJsonWithTimeout<ApiErrorBody>");
    expect(posSales).toContain("}, 12_000, 0);");
    expect(tableQrRoute).toContain("export const maxDuration = 10");
    expect(tableQrRoute).toContain('response.headers.set("Cache-Control", "private, no-store")');
    expect(tableQrRoute).not.toContain("s-maxage");
  });
  it("keeps Thai copy readable in the sales-mode arranger", () => {
    expect(salesModePreferenceEnhancer).toContain("จัดเรียงโหมดการขายของสาขา");
    expect(salesModePreferenceEnhancer).toContain("กดค้างแล้วลากการ์ดเพื่อสลับตำแหน่ง");
    expect(salesModePreferenceEnhancer).toContain("บันทึกทั้งสาขา");
    expect(salesModePreferenceEnhancer).not.toContain("เธ");
    expect(salesModePreferenceEnhancer).not.toContain("เน€");
  });

  it("uses compare-and-set review transitions and stable kitchen confirm ids", () => {
    expect(qrOrdering).toContain("isTerminalQrReviewStatus");
    expect(qrOrdering).toContain("loadAlreadyReviewedQrResult");
    expect(qrOrdering).toContain("review_conflict");
    expect(qrOrdering).toContain("buildQrReviewKitchenConfirmRequestId(args.submissionId)");
    expect(qrOrdering).toContain('.eq("review_status", "pending_pos_review")');
    expect(qrOrdering).toContain('.eq("review_status", "kitchen_confirming")');
    expect(qrOrdering).toContain("maybeSingle<PendingQrSubmissionRow>()");
    expect(qrOrdering).toContain('lifecycle: "restaurant_qr_pos_review_v1"');
  });

  it("returns existing Restaurant QR print jobs on duplicate idempotency and separates routed copies", () => {
    expect(printService).toContain("isRestaurantQrScope");
    expect(printService).toContain("isUniqueConstraintError");
    expect(printService).toContain("loadExistingPrintJobByIdempotencyKey");
    expect(printService).toContain("if (existing) return existing");
    expect(routedPrintService).toContain("buildRoutePrintIdempotencyKey");
    expect(routedPrintService).toContain("printer:${args.route.printer.id}");
    expect(routedPrintService).toContain("device:${args.route.printerDeviceId");
    expect(routedPrintService).toContain("copy:${args.copy}");
  });

  it("adds unapplied Primary and Trial Restaurant QR cancelled-order claim guards", () => {
    for (const migration of [primaryMigration, trialMigration]) {
      expect(migration).toContain("RESTAURANT_QR_CANCELLED_ORDER_PRINT_CLAIM_GUARD");
      expect(migration).toContain("app.claim_print_jobs_v2");
      expect(migration).toContain("app.restaurant_qr_store_registry");
      expect(migration).toContain("app.is_restaurant_qr_scope");
      expect(migration).toContain("from public.orders o");
      expect(migration).toContain("o.status::text = 'cancelled'");
      expect(migration).toContain("notify pgrst, 'reload schema'");
    }
  });
});
