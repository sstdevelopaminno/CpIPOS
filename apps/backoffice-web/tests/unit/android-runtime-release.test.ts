import { describe, expect, it } from "vitest";
import { ANDROID_MODERN_RELEASE, buildAndroidModernUpdateOffer } from "@/lib/android-runtime-release";

function modernPayload(versionCode: number) {
  return {
    app: { version_code: versionCode },
    runtime_capabilities: {
      schema_version: 3,
      updates: {
        channel: "modern",
        managed_notice: true,
        silent_install: false,
        forced_update: false
      }
    }
  };
}

describe("android modern update offer", () => {
  it("never offers updates to a legacy payload without opt-in capability", () => {
    expect(buildAndroidModernUpdateOffer({
      tenantCode: "STORE-001",
      payload: { app: { version_code: 18 } }
    })).toBeNull();
  });

  it("explicitly protects FG0003 even if a modern capability is reported", () => {
    expect(buildAndroidModernUpdateOffer({
      tenantCode: "FG0003",
      payload: modernPayload(22)
    })).toBeNull();
  });

  it("explicitly protects the common FG00003 typo as a defensive alias", () => {
    expect(buildAndroidModernUpdateOffer({
      tenantCode: "FG00003",
      payload: modernPayload(22)
    })).toBeNull();
  });

  it("offers only the latest modern release to an opted-in older modern runtime", () => {
    expect(buildAndroidModernUpdateOffer({
      tenantCode: "900001",
      payload: modernPayload(22)
    })).toEqual({
      channel: "modern",
      version_name: ANDROID_MODERN_RELEASE.versionName,
      version_code: ANDROID_MODERN_RELEASE.versionCode,
      download_url: ANDROID_MODERN_RELEASE.downloadUrl,
      mandatory: false
    });
  });

  it("does not offer when the modern runtime is already current", () => {
    expect(buildAndroidModernUpdateOffer({
      tenantCode: "900001",
      payload: modernPayload(ANDROID_MODERN_RELEASE.versionCode)
    })).toBeNull();
  });

  it("fails closed if a server/client capability implies forced or silent installation", () => {
    const payload = modernPayload(22);
    (payload.runtime_capabilities.updates as Record<string, unknown>).forced_update = true;
    expect(buildAndroidModernUpdateOffer({ tenantCode: "900001", payload })).toBeNull();
  });
});
