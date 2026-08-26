import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const androidBuild = source("../../../pos-android/app/build.gradle.kts");
const mainActivity = source("../../../pos-android/app/src/main/java/com/cpipos/pos/MainActivity.kt");
const updatePolicy = source("../../src/app/api/android-pos/update-policy/route.ts");
const mandatoryUpdate = source("../../src/components/android-pos/android-pos-mandatory-update.tsx");
const androidRuntimeRelease = source("../../src/lib/android-runtime-release.ts");
const mdmHeartbeat = source("../../src/app/api/android-pos/mdm/heartbeat/route.ts");
const downloadLatest = source("../../src/app/download/android/latest/route.ts");

describe("Android POS stable/Modern update safety regression contract", () => {
  it("keeps the legacy stable native package identity on 1.0.12 / versionCode 18", () => {
    expect(androidBuild).toContain('versionCode = 18');
    expect(androidBuild).toContain('versionName = "1.0.12"');
    expect(androidBuild).toContain('val updateChannel = providers.gradleProperty("cpiposUpdateChannel")');
    expect(androidBuild).toContain('val managedUpdaterEnabled = providers.gradleProperty("cpiposManagedUpdater")');
    expect(mainActivity).toContain('append(" CpIPOS-AndroidPOS/")');
    expect(mainActivity).toContain('append(BuildConfig.VERSION_NAME)');
  });

  it("keeps the legacy update-policy endpoint fail-closed around its verified stable release", () => {
    expect(updatePolicy).toContain('const STABLE_ASSET_NAME = "CpIPOS-Android-POS.apk"');
    expect(updatePolicy).toContain('const requiredVersion = configuredRequiredVersion ?? stableVersionedAsset.version');
    expect(updatePolicy).toContain('const releaseReady = compareVersions(stableVersionedAsset.version, requiredVersion) >= 0');
    expect(updatePolicy).toContain('forceUpdate: forceUpdateEnabled && releaseReady');
    expect(updatePolicy).toContain('downloadUrl: "/download/android/latest"');
    expect(updatePolicy).toContain('forceUpdate: false');
    expect(updatePolicy).toContain('releaseReady: false');
  });

  it("keeps browser update enforcement low-churn and non-blocking for FG0003 recovery", () => {
    expect(mandatoryUpdate).toContain("const POLL_MS = 10 * 60_000");
    expect(mandatoryUpdate).toContain("FG0003_ROLLBACK_INSTALL_ID");
    expect(mandatoryUpdate).toContain("window.localStorage.setItem(CUSTOMER_DISPLAY_V2_ENABLED_KEY, \"0\")");
    expect(mandatoryUpdate).toContain("setRequired(false)");
    expect(mandatoryUpdate).toContain("/api/android-pos/update-enforcement");
    expect(mandatoryUpdate).toContain("document.visibilityState === \"visible\"");
    expect(mandatoryUpdate).not.toContain("NATIVE_ANDROID_POS_PATTERN");
  });

  it("offers Modern 1.0.21 code29 only by explicit capability opt-in", () => {
    expect(androidRuntimeRelease).toContain('versionName: "1.0.21"');
    expect(androidRuntimeRelease).toContain('versionCode: 29');
    expect(androidRuntimeRelease).toContain('new Set(["FG0003", "FG00003"])');
    expect(androidRuntimeRelease).toContain('if (updates.managed_notice !== true) return null;');
    expect(androidRuntimeRelease).toContain('if (updates.silent_install !== false) return null;');
    expect(androidRuntimeRelease).toContain('if (updates.forced_update !== false) return null;');
    expect(androidRuntimeRelease).toContain('mandatory: false');
  });

  it("keeps FG0003 fail-closed unless a verified staged updater is maintenance locked", () => {
    expect(androidRuntimeRelease).toContain('const verifiedStagedUpdater = supportsVerifiedStagedUpdater(updates);');
    expect(androidRuntimeRelease).toContain('const maintenanceLocked = String(input.deviceStatus ?? "").trim().toLowerCase() === "maintenance" && input.deviceLocked === true;');
    expect(androidRuntimeRelease).toContain('if (protectedLegacyTenant && !(verifiedStagedUpdater && maintenanceLocked)) return null;');
    expect(androidRuntimeRelease).toContain('install_policy: protectedLegacyTenant ? "staged" : "notice_only"');
    expect(mdmHeartbeat).toContain('deviceStatus: scope.status');
    expect(mdmHeartbeat).toContain('deviceLocked: scope.is_locked');
  });

  it("pins the customer stable download route to the 1.0.12 versioned APK with no old-version fallback", () => {
    expect(downloadLatest).toContain('const expectedVersion = "1.0.12"');
    expect(downloadLatest).toContain('const expectedAssetName = `CpIPOS-Android-POS-${expectedVersion}.apk`');
    expect(downloadLatest).toContain('item.name === expectedAssetName');
    expect(downloadLatest).toContain('redirect.headers.set("X-CpIPOS-Android-Version", expectedVersion)');
    expect(downloadLatest).not.toContain('stableAsset ?? fallbackAsset');
  });
});
