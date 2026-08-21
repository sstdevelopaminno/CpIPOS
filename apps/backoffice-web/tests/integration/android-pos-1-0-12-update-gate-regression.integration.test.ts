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
const downloadLatest = source("../../src/app/download/android/latest/route.ts");

describe("Android POS stable/Modern update safety regression contract", () => {
  it("keeps the legacy stable native package identity on 1.0.12 / versionCode 18", () => {
    expect(androidBuild).toContain('versionCode = 18');
    expect(androidBuild).toContain('versionName = "1.0.12"');
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

  it("keeps the browser legacy mandatory-update overlay disabled instead of forcing existing stores", () => {
    expect(mandatoryUpdate).toContain("Legacy mandatory-update overlay intentionally disabled");
    expect(mandatoryUpdate).toContain("protected customer stores");
    expect(mandatoryUpdate).toContain("non-forced ManagedUpdateNotice flow");
    expect(mandatoryUpdate).toContain("export function AndroidPosMandatoryUpdate() {");
    expect(mandatoryUpdate).toContain("return null;");
    expect(mandatoryUpdate).not.toContain("NATIVE_ANDROID_POS_PATTERN");
  });

  it("offers Modern only by explicit capability opt-in and never to FG0003", () => {
    expect(androidRuntimeRelease).toContain('versionName: "1.0.20"');
    expect(androidRuntimeRelease).toContain('versionCode: 26');
    expect(androidRuntimeRelease).toContain('new Set(["FG0003", "FG00003"])');
    expect(androidRuntimeRelease).toContain('if (tenantCode && PROTECTED_LEGACY_TENANT_CODES.has(tenantCode)) return null;');
    expect(androidRuntimeRelease).toContain('if (updates.managed_notice !== true) return null;');
    expect(androidRuntimeRelease).toContain('if (updates.silent_install !== false) return null;');
    expect(androidRuntimeRelease).toContain('if (updates.forced_update !== false) return null;');
    expect(androidRuntimeRelease).toContain('mandatory: false');
  });

  it("pins the customer stable download route to the 1.0.12 versioned APK with no old-version fallback", () => {
    expect(downloadLatest).toContain('const expectedVersion = "1.0.12"');
    expect(downloadLatest).toContain('const expectedAssetName = `CpIPOS-Android-POS-${expectedVersion}.apk`');
    expect(downloadLatest).toContain('item.name === expectedAssetName');
    expect(downloadLatest).toContain('redirect.headers.set("X-CpIPOS-Android-Version", expectedVersion)');
    expect(downloadLatest).not.toContain('stableAsset ?? fallbackAsset');
  });
});
