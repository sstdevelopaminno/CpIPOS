import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const buildGradle = readSource("../pos-android/app/build.gradle.kts");
const mainActivity = readSource("../pos-android/app/src/main/java/com/cpipos/pos/MainActivity.kt");
const presentation = readSource("../pos-android/app/src/main/java/com/cpipos/pos/DualScreenPresentation.kt");
const mdmAgent = readSource("../pos-android/app/src/main/java/com/cpipos/pos/PosMdmAgent.kt");
const mdmRoute = readSource("src/app/api/android-pos/mdm/heartbeat/route.ts");
const mdmBase = readSource("src/lib/android-pos/mdm-heartbeat-base.ts");
const nativeStateRoute = readSource("src/app/api/pos/customer-display/v2/native-state/route.ts");
const nativeDisplay = readSource("src/components/pos/pos-customer-display-v2-native.tsx");
const nativePage = readSource("src/app/customer-display/v2/native/page.tsx");
const downloadCenter = readSource("src/app/download/download-center-latest.tsx");
const downloadRoute = readSource("src/app/download/android/dual-screen-1-0-13/route.ts");
const dualScreenWorkflow = readSource("../../.github/workflows/build-android-runtime-dual-screen.yml");

describe("Customer Display V2 Android dual-screen compatibility contract", () => {
  it("keeps 1.0.12 as the stable source build while allowing isolated versioned Android artifacts", () => {
    expect(buildGradle).toContain('versionCode = 18');
    expect(buildGradle).toContain('versionName = "1.0.12"');
    expect(buildGradle).toContain('providers.gradleProperty("cpiposVersionName")');
    expect(buildGradle).toContain('providers.gradleProperty("cpiposVersionCode")');
    expect(buildGradle).toContain('providers.gradleProperty("cpiposDualScreen")');
    expect(buildGradle).toContain('CPIPOS_DUAL_SCREEN_ENABLED');
    expect(buildGradle).toContain('/customer-display/v2/native');
  });

  it("detects a secondary Android display and opens Customer Display V2 without replacing the main POS WebView", () => {
    expect(mainActivity).toContain("DisplayManager");
    expect(mainActivity).toContain("DISPLAY_CATEGORY_PRESENTATION");
    expect(mainActivity).toContain("DualScreenPresentation");
    expect(mainActivity).toContain("CPIPOS_CUSTOMER_DISPLAY_V2_URL");
    expect(mainActivity).toContain("pos_customer_display_v2_enabled_v001");
    expect(mainActivity).toContain("setContentView(webView)");
    expect(presentation).toContain("class DualScreenPresentation");
    expect(presentation).toContain("Presentation(context, display)");
    expect(presentation).toContain("displayWebView.loadUrl(customerDisplayUrl)");
  });

  it("reports display capability through the shared MDM base while the wrapper adds printer auto-registry behavior", () => {
    expect(mdmAgent).toContain("buildDisplaySnapshot");
    expect(mdmAgent).toContain("presentation_display_count");
    expect(mdmAgent).toContain("secondary_display_available");
    expect(mdmAgent).toContain("width_px");
    expect(mdmAgent).toContain("height_px");
    expect(mdmRoute).toContain('GET as baseGet, POST as basePost');
    expect(mdmRoute).toContain("const baseResponse = await basePost(request)");
    expect(mdmBase).toContain("android_mdm_displays: asRecord(payload?.displays)");
    expect(mdmBase).toContain("const safeAtMs = atMs > serverNowMs ? serverNowMs : atMs");
    expect(mdmBase).toContain("device_reported_at");
  });

  it("reads native display state only from the authenticated POS device channel", () => {
    expect(nativeStateRoute).toContain('requirePermission(scope, "sale:create")');
    expect(nativeStateRoute).toContain("scope.session.device_id");
    expect(nativeStateRoute).toContain("scope.session.device_code");
    expect(nativeStateRoute).toContain("buildCustomerDisplayV2Channel");
    expect(nativeStateRoute).toContain('from("pos_customer_display_states")');
    expect(nativeStateRoute).not.toContain("searchParams.get(\"channel\")");
  });

  it("uses shared authenticated cookies for the integrated second screen instead of a manual pairing code", () => {
    expect(nativePage).toContain("PosCustomerDisplayV2Native");
    expect(nativeDisplay).toContain('fetch("/api/pos/customer-display/v2/native-state"');
    expect(nativeDisplay).toContain('credentials: "same-origin"');
    expect(nativeDisplay).not.toContain("pairing_code");
    expect(nativeDisplay).not.toContain("x-customer-display-token");
  });

  it("promotes the current Modern Runtime as the 1–2 screen standard while retaining legacy and repair paths", () => {
    expect(downloadCenter).toContain("CpIPOS POS - Modern Runtime");
    expect(downloadCenter).toContain("ANDROID_MODERN_RELEASE.versionName");
    expect(downloadCenter).toContain("1–2 จอ");
    expect(downloadCenter).toContain("CpIPOS POS - Legacy Stable");
    expect(downloadCenter).toContain("1.0.12");
    expect(downloadCenter).toContain("Android POS 1.0.13 ถูกนำออกจากหน้า Download หลัก");
    expect(downloadRoute).toContain("android-runtime-dual-screen-1-0-13");
    expect(downloadRoute).toContain("CpIPOS-Android-POS-1.0.13-Dual-Screen.apk");
  });

  it("retains the signed 1.0.13 repair artifact without overwriting the stable release", () => {
    expect(dualScreenWorkflow).toContain("ANDROID_RUNTIME_VERSION: 1.0.13");
    expect(dualScreenWorkflow).toContain('ANDROID_RUNTIME_VERSION_CODE: "19"');
    expect(dualScreenWorkflow).toContain("ANDROID_RUNTIME_RELEASE_TAG: android-runtime-dual-screen-1-0-13");
    expect(dualScreenWorkflow).toContain("-PcpiposDualScreen=true");
    expect(dualScreenWorkflow).not.toContain("ANDROID_RUNTIME_RELEASE_TAG: android-runtime-latest");
  });
});
