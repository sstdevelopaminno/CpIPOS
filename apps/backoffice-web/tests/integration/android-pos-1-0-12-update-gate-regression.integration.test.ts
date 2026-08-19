import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const androidBuild = source("../../../pos-android/app/build.gradle.kts");
const mainActivity = source("../../../pos-android/app/src/main/java/com/cpipos/pos/MainActivity.kt");
const updatePolicy = source("../../src/app/api/android-pos/update-policy/route.ts");
const mandatoryUpdate = source("../../src/components/android-pos/android-pos-mandatory-update.tsx");
const downloadLatest = source("../../src/app/download/android/latest/route.ts");

describe("Android POS 1.0.12 update-gate regression contract", () => {
  it("keeps the native package identity on 1.0.12 / versionCode 18", () => {
    expect(androidBuild).toContain('versionCode = 18');
    expect(androidBuild).toContain('versionName = "1.0.12"');
    expect(mainActivity).toContain('append(" CpIPOS-AndroidPOS/")');
    expect(mainActivity).toContain('append(BuildConfig.VERSION_NAME)');
  });

  it("resolves the required version from the verified stable release", () => {
    expect(updatePolicy).toContain('const STABLE_ASSET_NAME = "CpIPOS-Android-POS.apk"');
    expect(updatePolicy).toContain('const requiredVersion = configuredRequiredVersion ?? stableVersionedAsset.version');
    expect(updatePolicy).toContain('const releaseReady = compareVersions(stableVersionedAsset.version, requiredVersion) >= 0');
    expect(updatePolicy).toContain('forceUpdate: forceUpdateEnabled && releaseReady');
    expect(updatePolicy).toContain('downloadUrl: "/download/android/latest"');
  });

  it("blocks only native Android POS versions below the required version", () => {
    expect(mandatoryUpdate).toContain('const NATIVE_ANDROID_POS_PATTERN = /CpIPOS-AndroidPOS\\/(\\d+\\.\\d+\\.\\d+)/i');
    expect(mandatoryUpdate).toContain('if (!currentVersion || !policy?.forceUpdate || !policy.requiredVersion) return null;');
    expect(mandatoryUpdate).toContain('if (compareVersions(currentVersion, policy.requiredVersion) >= 0) return null;');
    expect(mandatoryUpdate).toContain('`ดาวน์โหลดและติดตั้ง Android POS ${policy.requiredVersion}`');
  });

  it("does not force an update when release lookup is unavailable", () => {
    expect(updatePolicy).toContain('forceUpdate: false');
    expect(updatePolicy).toContain('releaseReady: false');
    expect(updatePolicy).toContain('status: 503');
  });

  it("pins the customer download route to the 1.0.12 versioned APK with no old-version fallback", () => {
    expect(downloadLatest).toContain('const expectedVersion = "1.0.12"');
    expect(downloadLatest).toContain('const expectedAssetName = `CpIPOS-Android-POS-${expectedVersion}.apk`');
    expect(downloadLatest).toContain('item.name === expectedAssetName');
    expect(downloadLatest).toContain('redirect.headers.set("X-CpIPOS-Android-Version", expectedVersion)');
    expect(downloadLatest).not.toContain('stableAsset ?? fallbackAsset');
  });
});
