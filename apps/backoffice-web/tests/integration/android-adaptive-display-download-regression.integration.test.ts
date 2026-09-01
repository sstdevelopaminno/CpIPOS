import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const downloadCenter = source("../../src/app/download/download-center-latest.tsx");
const releaseCatalog = source("../../src/lib/android-runtime-release.ts");
const mainActivity = source("../../../pos-android/app/src/main/java/com/cpipos/pos/MainActivity.kt");
const mdmAgent = source("../../../pos-android/app/src/main/java/com/cpipos/pos/PosMdmAgent.kt");
const printAgent = source("../../../pos-android/app/src/main/java/com/cpipos/pos/PosPrintAgent.kt");
const globals = source("../../src/app/globals.css");
const modernWorkflow = source("../../../../.github/workflows/build-android-modern-runtime.yml");

describe("Android adaptive display + Download Center regression contract", () => {
  it("keeps exactly two primary Android POS download lanes: Modern left and Legacy right", () => {
    expect(downloadCenter).toContain('title: "CpIPOS POS - Modern Adaptive"');
    expect(downloadCenter).toContain('title: "CpIPOS POS - Legacy Single Screen"');
    expect(downloadCenter).toContain("{androidPosApps.map((app) => <DownloadCard key={app.title} app={app} />)}");
    expect(downloadCenter.indexOf('title: "CpIPOS POS - Modern Adaptive"')).toBeLessThan(
      downloadCenter.indexOf('title: "CpIPOS POS - Legacy Single Screen"')
    );
  });

  it("publishes Modern as one adaptive APK instead of one APK per screen count", () => {
    expect(releaseCatalog).toContain('displaySupport: "auto_1_2_screens"');
    expect(releaseCatalog).toContain('layoutPolicy: "runtime_adaptive"');
    expect(downloadCenter).toContain("APK เดียวสำหรับ 1–2 จอ");
    expect(modernWorkflow).toContain("-PcpiposDualScreen=true");
    expect(modernWorkflow).toContain('"display_support": "auto_1_2_screens"');
    expect(modernWorkflow).toContain('"layout_policy": "runtime_adaptive"');
  });

  it("detects physical Android displays at runtime and fails back to one screen", () => {
    expect(mdmAgent).toContain("DisplayManager.DISPLAY_CATEGORY_PRESENTATION");
    expect(mdmAgent).toContain('.put("width_px", mode.physicalWidth)');
    expect(mdmAgent).toContain('.put("height_px", mode.physicalHeight)');
    expect(mdmAgent).toContain('.put("secondary_display_available"');
    expect(mainActivity).toContain("syncDualScreenPresentation()");
    expect(mainActivity).toContain("if (secondaryDisplay == null)");
    expect(mainActivity).toContain("activeSecondaryDisplayId = null");
    expect(mainActivity).toContain("applyCustomerDisplayV2Flag()");
  });

  it("keeps the Web POS responsive for narrow, tablet and 1280x800-class viewports", () => {
    expect(globals).toContain("@media (max-width: 960px)");
    expect(globals).toContain("@media (max-width: 640px)");
    expect(globals).toContain("Tablet Landscape: 1024x768, Android Tablet Landscape: 1280x800");
    expect(globals).toContain("min-width: 1000px");
    expect(globals).toContain("max-width: 1300px");
  });

  it("keeps the new APK inside the Vercel Hobby request guardrail", () => {
    expect(printAgent).toContain("IDLE_BACKOFF_SECONDS = longArrayOf(30L, 45L, 60L)");
    expect(printAgent).toContain('claim_poll_policy", "adaptive_30_45_60s"');
    expect(printAgent).toContain("scheduleWakeClaim(0L)");
    expect(printAgent).toContain("scheduleWakeClaim(WAKE_RETRY_DELAY_MS)");
    expect(printAgent).toContain("WAKE_RETRY_DELAY_MS = 350L");
    expect(printAgent).not.toContain("longArrayOf(1L, 3L, 8L)");
  });
});
