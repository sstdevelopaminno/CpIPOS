import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "../..");
const src = (relative: string) => readFileSync(resolve(root, relative), "utf8");

const modernWorkflow = src(".github/workflows/build-android-modern-runtime.yml");
const mdmWorkflow = src(".github/workflows/validate-mdm-android-1023.yml");
const manifest = src("apps/pos-android/app/src/main/AndroidManifest.xml");
const transport = src("apps/pos-android/app/src/main/java/com/cpipos/pos/NativePrintTransport.kt");
const printAgent = src("apps/pos-android/app/src/main/java/com/cpipos/pos/PosPrintAgent.kt");
const mdmAgent = src("apps/pos-android/app/src/main/java/com/cpipos/pos/FullMdmAgent.kt");
const runtimeRelease = src("apps/backoffice-web/src/lib/android-runtime-release.ts");
const latestRoute = src("apps/backoffice-web/src/app/download/android/latest/route.ts");

describe("Android Modern print stability release and native print contract", () => {
  it("uses one final Modern release identity with an upgradeable versionCode", () => {
    expect(modernWorkflow).toContain("ANDROID_RUNTIME_VERSION: 1.0.24");
    expect(modernWorkflow).toContain('ANDROID_RUNTIME_VERSION_CODE: "33"');
    expect(modernWorkflow).toContain("ANDROID_RUNTIME_RELEASE_TAG: android-runtime-modern-1.0.24-print-stability");
    expect(runtimeRelease).toContain('versionName: "1.0.24"');
    expect(runtimeRelease).toContain("versionCode: 33");
    expect(runtimeRelease).toContain('releaseTag: "android-runtime-modern-1.0.24-print-stability"');
    expect(latestRoute).toContain("ANDROID_MODERN_RELEASE.releaseTag");
    expect(latestRoute).not.toContain('const expectedVersion = "1.0.23"');
  });

  it("requires production signing and rejects a debuggable final APK", () => {
    expect(modernWorkflow).toContain("ANDROID_SIGNING_CERT_SHA256");
    expect(modernWorkflow).toContain("apksignerPath");
    expect(modernWorkflow).toContain("certificate mismatch");
    expect(modernWorkflow).toContain('grep -q "^application-debuggable"');
    expect(modernWorkflow).toContain("Release APK must not be debuggable");
  });

  it("keeps all three supported ESC/POS transports and durable queue acknowledgements", () => {
    expect(transport).toContain('connectionType == "NETWORK_ESC_POS"');
    expect(transport).toContain('connectionType == "LOCAL_BRIDGE"');
    expect(transport).toContain('connectionType == "BLUETOOTH_BRIDGE"');
    expect(transport).toContain("usb_printer_ambiguous");
    expect(transport).toContain("bluetooth_printer_not_paired");
    expect(printAgent).toContain("/api/print-agent/v1/jobs/claim");
    expect(printAgent).toContain("/ack");
    expect(printAgent).toContain("/fail");
    expect(printAgent).toContain("IDLE_BACKOFF_SECONDS = longArrayOf(1L, 3L, 8L, 15L)");
    expect(printAgent).toContain("WAKE_RETRY_DELAY_MS = 350L");
  });

  it("ships the current Full MDM uninstall executor in the same final APK", () => {
    expect(manifest).toContain("android.permission.REQUEST_DELETE_PACKAGES");
    expect(manifest).toContain('android:name=".MdmUninstallResultReceiver"');
    expect(manifest).toContain('android:exported="false"');
    expect(mdmAgent).toContain('capabilities.put("app_uninstall")');
    expect(mdmAgent).toContain("packageInstaller.uninstall");
    expect(mdmWorkflow).toContain("MdmUninstallResultReceiver");
    expect(mdmWorkflow).toContain('ANDROID_RUNTIME_VERSION_CODE: "32"');
  });
});
