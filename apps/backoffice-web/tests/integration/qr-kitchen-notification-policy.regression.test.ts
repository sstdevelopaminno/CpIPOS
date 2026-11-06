import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const posActivity = read("apps/backoffice-web/src/app/api/pos/table-qr-activity/route.ts");
const qrSubmission = read("apps/backoffice-web/src/lib/table-qr-ordering.ts");
const profile = read("apps/backoffice-web/src/lib/services/restaurant-qr-kitchen-profile-service.ts");
const policy = read("apps/backoffice-web/src/lib/services/table-qr-automation-policy-service.ts");
const settingsApi = read("apps/backoffice-web/src/app/api/pos/settings/order-kitchen/route.ts");
const settingsUi = read("apps/backoffice-web/src/components/pos-preview/order-kitchen-settings-page.tsx");
const kds = read("apps/backoffice-web/src/components/kitchen/kitchen-kds.tsx");
const kdsQueue = read("apps/backoffice-web/src/app/api/pos/kitchen/queue/route.ts");
const posAlert = read("apps/backoffice-web/src/components/pos-preview/pos-table-qr-global-alert.tsx");
const posSales = read("apps/backoffice-web/src/components/pos/pos-sales-module.tsx");
const cashierReviewRoute = read("apps/backoffice-web/src/app/api/pos/restaurant-qr-policy/route.ts");
const migration = read("supabase/migrations/20261106130420_kds_popup_audio_and_qr_print_policy.sql");
const routedPrint = read("apps/backoffice-web/src/lib/printing/routed-print-service.ts");

describe("QR cashier approval and Kitchen alert settings regression", () => {
  it("applies the same tenant+branch cashier review policy to QR submission and cashier polling", () => {
    expect(qrSubmission).toContain("await loadRestaurantQrKitchenFlagsForScope(");
    expect(posActivity).toContain("await loadRestaurantQrKitchenFlagsForScope(");
    expect(profile).toContain("table_qr_cashier_review_required");
    expect(profile).toContain("resolveProductProfile");
    expect(profile).toContain("ttlMs: 10_000");
    expect(cashierReviewRoute).toContain('requiredPermission: "sales:view"');
    expect(cashierReviewRoute).toContain("await loadRestaurantQrKitchenFlagsForScope(");
    expect(posSales).toContain('fetch("/api/pos/restaurant-qr-policy"');
    expect(posSales).toContain("restaurantQrReviewPolicy.scope !== restaurantQrPolicyScope");
    expect(posSales).toContain("setRestaurantQrReviewPolicy({ scope, required: payload.data.cashier_review_required })");
  });

  it("sends only changed settings so Kitchen audio changes never demand a QR entitlement", () => {
    expect(settingsUi).toContain("kitchen_alert_sound_enabled: kitchenAlertDraft.sound_enabled");
    expect(settingsUi).toContain("cashier_review_required: cashierReviewDraft");
    expect(settingsUi).toContain("draft.popup_enabled !== policy.store.popup_enabled");
    expect(settingsApi).toContain("const wantsKitchenAlert");
    expect(settingsApi).toContain("if (wantsQrPolicy)");
    expect(settingsApi).toContain("if (body.kitchen_auto_print_enabled === true)");
    expect(policy).toContain("invalidateRestaurantQrReviewCache(tenantId, branchId)");
  });

  it("enforces the Kitchen popup and sound settings for both cashier and QR tickets", () => {
    expect(kdsQueue).toContain("kitchen_alert_settings: kitchenAlert");
    expect(kds).toContain("kitchenAlertsRef.current = nextSettings");
    expect(kds).toContain("if (settings.popup_enabled)");
    expect(kds).toContain("if (settings.sound_enabled) playAlertSound(settings.popup_enabled)");
    expect(kds).toContain("audio.volume = settings.sound_volume");
    expect(kds).toContain("setSoundArmed(true)");
    expect(kds).toContain("INITIAL_ALERT_RECENCY_MS");
    expect(kds).toContain('ALERT_EVENT_TYPES = new Set(["new", "add"])');
  });

  it("applies the pre-existing cashier sound mute and volume controls", () => {
    expect(posActivity).toContain("notification_sound: notificationSound");
    expect(posAlert).toContain("notificationSoundRef.current.enabled");
    expect(posAlert).toContain("notificationSoundRef.current.volume");
  });

  it("delivers staff-approved QR tickets, and reports a missing Kitchen route instead of false success", () => {
    expect(qrSubmission).toContain("await dispatchOrderToKitchen({");
    expect(qrSubmission).toContain("kitchen_sent: kitchenSent");
    expect(qrSubmission).toContain('"KITCHEN_ROUTE_MISSING"');
    expect(qrSubmission).toContain("already_reviewed: true");
  });

  it("blocks only automatic QR Kitchen print jobs while preserving POS and manual reprints", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS kitchen_alert_popup_enabled");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS table_qr_cashier_review_required");
    expect(migration).toContain("NEW.metadata->>'source' IS DISTINCT FROM 'app.enqueue_kitchen_order'");
    expect(migration).toContain("NEW.metadata->>'request_source' IS DISTINCT FROM 'kitchen_ticket_dispatch'");
    expect(migration).toContain("v_channel IS DISTINCT FROM 'table_qr'");
    expect(migration).toContain("= 'reprint'");
    expect(migration).toContain("RETURN NULL;");
    expect(migration).toContain("BEFORE INSERT ON public.print_jobs");
    expect(routedPrint).toContain("if (!args.forceReprint)");
    expect(routedPrint).toContain('order?.channel === "table_qr"');
    expect(routedPrint).toContain("isQrKitchenAutomaticPrintEnabledForScope");
  });
});
