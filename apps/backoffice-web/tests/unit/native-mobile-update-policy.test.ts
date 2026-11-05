import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  nativeManifestAsset,
  validNativeMobileReleaseCandidates,
  verifiedNativeMobileUpdate,
  NATIVE_MOBILE_RELEASE_CERT_SHA256,
  type NativeMobileRelease,
  type NativeMobileManifest
} from "../../src/lib/native-mobile-update-policy";

const release: NativeMobileRelease = {
  tag_name: "native-mobile-v2.1.0", draft: false, prerelease: false,
  assets: [
    { name: "CpIPOS-Native-Mobile-2.1.0.apk", size: 14000000,
      browser_download_url: "https://github.com/sstdevelopaminno/CpIPOS/releases/download/native-mobile-v2.1.0/CpIPOS-Native-Mobile-2.1.0.apk",
      digest: "sha256:" + "a".repeat(64) },
    { name: "CpIPOS-Native-Mobile-2.1.0.manifest.json", size: 400,
      browser_download_url: "https://github.com/sstdevelopaminno/CpIPOS/releases/download/native-mobile-v2.1.0/CpIPOS-Native-Mobile-2.1.0.manifest.json" }
  ]
};
const manifest: NativeMobileManifest = {
  channel: "native_mobile", version_name: "2.1.0", version_code: 2010000,
  package_name: "com.cpipos.pos.next",
  asset_name: "CpIPOS-Native-Mobile-2.1.0.apk", sha256: "a".repeat(64),
  signing_cert_sha256: NATIVE_MOBILE_RELEASE_CERT_SHA256,
  min_sdk: 26, source_repository: "sstdevelopaminno/cpipos-native-pos",
  source_commit: "b".repeat(40)
};

describe("Native Mobile stable automatic-update policy", () => {
  it("caches external metadata server-side without caching client update state", () => {
    const route = readFileSync(resolve(process.cwd(), "src/app/api/android-pos/native-update-policy/route.ts"), "utf8");
    expect(route).toContain("next: { revalidate: 60 }");
    expect(route).toContain('"Cache-Control": "private, no-store, max-age=0"');
    expect(route).toContain("if (!valid) return unavailable()");
  });

  it("only selects stable versioned releases", () => {
    expect(validNativeMobileReleaseCandidates([
      {...release, tag_name:"native-mobile-v2.1.1", prerelease: true},
      {...release, tag_name:"android-runtime-latest"},
      release
    ])).toEqual([release]);
  });
  it("exposes verified stable apk and manifest only", () => {
    expect(verifiedNativeMobileUpdate(release, manifest)?.versionCode).toBe(2010000);
    expect(nativeManifestAsset(release)).toContain(".manifest.json");
  });
  it("rejects wrong signature/digest and prerelease", () => {
    expect(verifiedNativeMobileUpdate(release, {...manifest, signing_cert_sha256: "0".repeat(64)})).toBeNull();
    expect(verifiedNativeMobileUpdate(release, {...manifest, sha256: "f".repeat(64)})).toBeNull();
    expect(verifiedNativeMobileUpdate({...release, prerelease: true}, manifest)).toBeNull();
  });
});
