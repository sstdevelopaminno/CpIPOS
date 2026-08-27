import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const qrOrdering = readFileSync(new URL("../../src/lib/table-qr-ordering.ts", import.meta.url), "utf8");
const hardeningFlags = readFileSync(new URL("../../src/lib/restaurant-qr-profile.ts", import.meta.url), "utf8");
const compatibilityAlias = readFileSync(new URL("../../src/lib/fg0003-qr-kitchen-hardening.ts", import.meta.url), "utf8");
const publicRoute = readFileSync(new URL("../../src/app/api/table-order/[token]/route.ts", import.meta.url), "utf8");
const mobileOrder = readFileSync(new URL("../../src/components/table-order/table-order-mobile.tsx", import.meta.url), "utf8");
const posSales = readFileSync(new URL("../../src/components/pos/pos-sales-module.tsx", import.meta.url), "utf8");
const posQrRoute = readFileSync(new URL("../../src/app/api/pos/tables/[tableId]/qr-orders/route.ts", import.meta.url), "utf8");
const posTablesRoute = readFileSync(new URL("../../src/app/api/pos/tables/route.ts", import.meta.url), "utf8");
const primaryMigration = readFileSync(new URL("../../../../supabase/migrations/202608240001_fg0003_qr_pos_review_lifecycle.sql", import.meta.url), "utf8");
const trialMigration = readFileSync(new URL("../../../../supabase/trial-data-plane/migrations/202608240001_trial_fg0003_qr_pos_review_lifecycle.sql", import.meta.url), "utf8");

describe("Restaurant QR to POS to Kitchen hardening", () => {
  it("centralizes the Restaurant QR feature decision without tenant UUID coupling", () => {
    expect(hardeningFlags).toContain('RESTAURANT_QR_PRODUCT_PROFILE = "RESTAURANT_QR"');
    expect(hardeningFlags).toContain("resolveRestaurantQrKitchenFlags");
    expect(hardeningFlags).toContain('tenantCode.startsWith("FG")');
    expect(hardeningFlags).toContain('branchCode.startsWith("FG")');
    expect(qrOrdering).toContain("resolveRestaurantQrKitchenFlags");
    expect(posSales).toContain("restaurantQrKitchenHardeningActive");
    expect(compatibilityAlias).toContain("resolveRestaurantQrKitchenFlags as resolveQrKitchenHardeningFlags");
  });

  it("stores Restaurant QR customer QR submits as POS-review pending without kitchen enqueue", () => {
    const pendingInsert = qrOrdering.slice(qrOrdering.indexOf("async function insertPendingTableQrOrder"), qrOrdering.indexOf("async function loadRecentQrOrderPayloadDuplicate"));
    expect(pendingInsert).toContain('order_id: null');
    expect(pendingInsert).toContain('review_status: "pending_pos_review"');
    expect(pendingInsert).toContain('kitchen_status: "waiting_staff_confirmation"');
    expect(pendingInsert).not.toContain("submit_table_qr_order_tx");
    expect(pendingInsert).not.toContain("queueTableQrKitchenPrints");
  });

  it("returns pending review state to the mobile QR UI", () => {
    expect(publicRoute).toContain("kitchen_pending_review");
    expect(publicRoute).toContain("review_status");
    expect(mobileOrder).toContain("kitchen_pending_review");
    expect(mobileOrder).toContain("pending_pos_review");
  });

  it("exposes staff accept or reject and only sends kitchen after confirmation", () => {
    expect(posQrRoute).toContain("export async function POST");
    expect(posQrRoute).toContain("reviewPendingTableQrOrder");
    expect(qrOrdering).toContain('review_status: "kitchen_confirming"');
    expect(qrOrdering).toContain("submit_table_qr_order_tx");
    expect(qrOrdering).toContain("queueTableQrKitchenPrints({ context, orderId: row.order_id, requestId: buildQrReviewKitchenConfirmRequestId(args.submissionId) })");
    expect(qrOrdering).toContain('review_status: "rejected"');
    expect(qrOrdering).toContain('kitchen_status: "not_sent_rejected"');
  });

  it("alerts POS for QR order events and disables Restaurant QR dine-in auto-send", () => {
    expect(posSales).toContain('type: "order"');
    expect(posSales).toContain("notifyTableQrServiceRequest({ id: latestOrderEvent.id, type: \"order\"");
    expect(posSales).toContain("if (restaurantQrKitchenHardeningActive) return null;");
    expect(posTablesRoute).toContain('row.review_status === "pending_pos_review"');
  });

  it("adds primary and trial review lifecycle migrations", () => {
    for (const migration of [primaryMigration, trialMigration]) {
      expect(migration).toContain("review_status");
      expect(migration).toContain("pending_pos_review");
      expect(migration).toContain("kitchen_confirming");
      expect(migration).toContain("idx_table_qr_orders_pending_pos_review");
      expect(migration).toContain("idx_table_qr_orders_kitchen_submission_once");
    }
  });
});
