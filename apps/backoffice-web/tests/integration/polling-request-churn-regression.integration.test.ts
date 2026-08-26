import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const globalAlert = source("../../src/components/pos-preview/pos-table-qr-global-alert.tsx");
const tableOrderMobile = source("../../src/components/table-order/table-order-mobile.tsx");
const androidMandatoryUpdate = source("../../src/components/android-pos/android-pos-mandatory-update.tsx");
const productMediaRoute = source("../../src/app/api/pos/product-media/route.ts");
const featureGate = source("../../src/lib/feature-gate.ts");

describe("polling request-churn regression guard", () => {
  it("backs the global POS Table QR alert off to 30s while idle", () => {
    expect(globalAlert).toContain("const IDLE_POLL_MS = [3000, 5000, 10000, 15000, 30000] as const");
    expect(globalAlert).toContain("inFlightRef.current");
    expect(globalAlert).toContain('document.visibilityState === "hidden"');
    expect(globalAlert).toContain("idleIndex = 0");
    expect(globalAlert).toContain("schedule(0)");
    expect(globalAlert).toContain('window.addEventListener("focus", onFocus)');
    expect(globalAlert).toContain('document.addEventListener("visibilitychange", onVisibilityChange)');
  });

  it("keeps customer Table QR status polling fast, bounded and non-overlapping", () => {
    expect(tableOrderMobile).toContain("const MENU_STATUS_POLL_MS = 3_000");
    expect(tableOrderMobile).toContain("cancelled || inFlight || document.visibilityState === \"hidden\"");
    expect(tableOrderMobile).toContain("inFlight = true");
    expect(tableOrderMobile).toContain("inFlight = false");
    expect(tableOrderMobile).toContain("window.setInterval(() => void refresh(), MENU_STATUS_POLL_MS)");
    expect(tableOrderMobile).toContain('window.addEventListener("focus", refresh)');
    expect(tableOrderMobile).toContain('document.addEventListener("visibilitychange", onVisible)');
  });

  it("keeps browser update enforcement low-frequency and visible-only", () => {
    expect(androidMandatoryUpdate).toContain("const POLL_MS = 10 * 60_000");
    expect(androidMandatoryUpdate).toContain("window.setInterval");
    expect(androidMandatoryUpdate).toContain("document.visibilityState === \"visible\"");
    expect(androidMandatoryUpdate).toContain("/api/android-pos/update-enforcement");
    expect(androidMandatoryUpdate).toContain("setRequired(false)");
    expect(androidMandatoryUpdate).not.toContain("setTimeout");
  });

  it("keeps product-media POS reads off the tenant-wide quota path unless explicitly requested", () => {
    expect(productMediaRoute).toContain('url.searchParams.get("include_quota")');
    expect(productMediaRoute).toContain("const quota = includeQuota ? await resolveProductMediaQuota(resolved.tenantId) : null");
    expect(productMediaRoute).not.toContain("Promise.all([\n      loadProductMediaMap");
  });

  it("collapses repeated feature entitlement contract reads during POS startup", () => {
    expect(featureGate).toContain("__latestContractInFlight");
    expect(featureGate).toContain("readLatestContractCache(tenantId)");
    expect(featureGate).toContain("writeLatestContractCache(tenantId, resolved)");
    expect(featureGate).toContain("contractInFlight.clear()");
  });
});
