import { describe, expect, it } from "vitest";
import {
  ANDROID_MODERN_RELEASE,
  ANDROID_UPDATE_SIGNING_CERT_SHA256,
  buildAndroidModernUpdateOffer
} from "@/lib/android-runtime-release";

function modernPayload(versionCode: number, stagedUpdater = false) {
  return {
    app: { version_code: versionCode },
    runtime_capabilities: {
      schema_version: stagedUpdater ? 5 : 4,
      updates: {
        channel: "modern",
        managed_notice: true,
        silent_install: false,
        forced_update: false,
        ...(stagedUpdater ? {
          staged_updater: true,
          interactive_install: true,
          package_installer: true,
          sha256_verification: true,
          signing_certificate_verification: true
        } : {})
      }
    }
  };
}

function expectedOffer(installPolicy: "notice_only" | "staged") {
  return {
    channel: "modern",
    version_name: ANDROID_MODERN_RELEASE.versionName,
    version_code: ANDROID_MODERN_RELEASE.versionCode,
    download_url: ANDROID_MODERN_RELEASE.downloadUrl,
    manifest_url: ANDROID_MODERN_RELEASE.manifestUrl,
    signing_cert_sha256: ANDROID_UPDATE_SIGNING_CERT_SHA256,
    install_policy: installPolicy,
    silent_when_device_owner: true,
    mandatory: false,
    latest: true
  };
}

describe("android modern update offer", () => {
  it("never offers updates to a legacy payload without opt-in capability", () => {
    expect(buildAndroidModernUpdateOffer({
      tenantCode: "STORE-001",
      payload: { app: { version_code: 18 } }
    })).toBeNull();
  });

  it("offers latest Modern release as notice-only to an opted-in Modern runtime", () => {
    expect(buildAndroidModernUpdateOffer({
      tenantCode: "FG0004",
      payload: modernPayload(26)
    })).toEqual(expectedOffer("notice_only"));
  });

  it("requires verified updater capability and maintenance lock when policy requests staged install", () => {
    const updatePolicy = { install_policy: "staged", require_verified_staged_updater: true };
    expect(buildAndroidModernUpdateOffer({
      tenantCode: "FG0004",
      payload: modernPayload(26),
      deviceStatus: "maintenance",
      deviceLocked: true,
      updatePolicy
    })).toBeNull();
    expect(buildAndroidModernUpdateOffer({
      tenantCode: "FG0004",
      payload: modernPayload(26, true),
      deviceStatus: "active",
      deviceLocked: false,
      updatePolicy
    })).toBeNull();
    expect(buildAndroidModernUpdateOffer({
      tenantCode: "FG0004",
      payload: modernPayload(26, true),
      deviceStatus: "maintenance",
      deviceLocked: true,
      updatePolicy
    })).toEqual(expectedOffer("staged"));
  });

  it("does not offer when the Modern runtime is already current", () => {
    expect(buildAndroidModernUpdateOffer({
      tenantCode: "900001",
      payload: modernPayload(ANDROID_MODERN_RELEASE.versionCode, true)
    })).toBeNull();
  });

  it("does not re-prompt installation when the Modern runtime is already current or newer", () => {
    expect(buildAndroidModernUpdateOffer({
      tenantCode: "900001",
      payload: modernPayload(ANDROID_MODERN_RELEASE.versionCode, true)
    })).toBeNull();
    expect(buildAndroidModernUpdateOffer({
      tenantCode: "900001",
      payload: modernPayload(ANDROID_MODERN_RELEASE.versionCode + 1, true)
    })).toBeNull();
  });

  it("fails closed if a client capability implies forced or silent installation policy", () => {
    const payload = modernPayload(26, true);
    (payload.runtime_capabilities.updates as Record<string, unknown>).forced_update = true;
    expect(buildAndroidModernUpdateOffer({ tenantCode: "900001", payload })).toBeNull();

    (payload.runtime_capabilities.updates as Record<string, unknown>).forced_update = false;
    (payload.runtime_capabilities.updates as Record<string, unknown>).silent_install = true;
    expect(buildAndroidModernUpdateOffer({ tenantCode: "900001", payload })).toBeNull();
  });
});
