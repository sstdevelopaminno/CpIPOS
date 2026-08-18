import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const globalAlert = source("../../src/components/pos-preview/pos-table-qr-global-alert.tsx");
const tableOrderMobile = source("../../src/components/table-order/table-order-mobile.tsx");
const androidMandatoryUpdate = source("../../src/components/android-pos/android-pos-mandatory-update.tsx");

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

  it("keeps customer Table QR status polling bounded and non-overlapping", () => {
    expect(tableOrderMobile).toContain("const MENU_STATUS_POLL_MS = 15_000");
    expect(tableOrderMobile).toContain("cancelled || inFlight || document.visibilityState === \"hidden\"");
    expect(tableOrderMobile).toContain("inFlight = true");
    expect(tableOrderMobile).toContain("inFlight = false");
    expect(tableOrderMobile).toContain("window.setInterval(() => void refresh(), MENU_STATUS_POLL_MS)");
    expect(tableOrderMobile).toContain('window.addEventListener("focus", refresh)');
    expect(tableOrderMobile).toContain('document.addEventListener("visibilitychange", onVisible)');
  });

  it("keeps Android mandatory-update checks low-churn without weakening foreground checks", () => {
    expect(androidMandatoryUpdate).toContain("const POLICY_REFRESH_MS = 2 * 60 * 1000");
    expect(androidMandatoryUpdate).toContain("policyCheckInFlightRef.current");
    expect(androidMandatoryUpdate).toContain('document.visibilityState === "visible"');
    expect(androidMandatoryUpdate).toContain("void refreshPolicy();");
    expect(androidMandatoryUpdate).toContain('window.addEventListener("focus", refreshPolicy)');
    expect(androidMandatoryUpdate).toContain('document.addEventListener("visibilitychange", handleVisibility)');
  });
});
