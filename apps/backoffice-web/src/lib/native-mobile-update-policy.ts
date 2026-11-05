export type NativeMobileReleaseAsset = {
  name: string;
  browser_download_url: string;
  size: number;
  digest?: string | null;
};

export type NativeMobileRelease = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: NativeMobileReleaseAsset[];
};

export type NativeMobileManifest = {
  channel: string;
  version_name: string;
  version_code: number;
  package_name: string;
  asset_name: string;
  sha256: string;
  signing_cert_sha256: string;
  min_sdk: number;
  source_repository: string;
  source_commit: string;
};

export const NATIVE_MOBILE_EXPECTED_PACKAGE = "com.cpipos.pos.next";
export const NATIVE_MOBILE_RELEASE_CERT_SHA256 =
  "6be0a9aef346a5b47162c8928c5018a01d0e7d81b4eb177bf2fb89922dc2a27a";

const STABLE_TAG = /^native-mobile-v(\d+)\.(\d+)\.(\d+)$/;
const HEX_SHA256 = /^[a-f0-9]{64}$/;

export function validNativeMobileReleaseCandidates(input: NativeMobileRelease[]) {
  return input
    .filter((release) => !release.draft && !release.prerelease && STABLE_TAG.test(release.tag_name))
    .sort((a, b) => {
      const aa = a.tag_name.match(STABLE_TAG)!.slice(1).map(Number);
      const bb = b.tag_name.match(STABLE_TAG)!.slice(1).map(Number);
      for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return bb[i] - aa[i];
      return 0;
    });
}

function expectedAssetNames(tag: string) {
  const version = tag.match(STABLE_TAG)?.slice(1).join(".");
  if (!version) return null;
  return {
    version,
    apk: `CpIPOS-Native-Mobile-${version}.apk`,
    manifest: `CpIPOS-Native-Mobile-${version}.manifest.json`
  };
}

/** A release must be stable, pinned to the known signing identity, and self-consistent. */
export function verifiedNativeMobileUpdate(
  release: NativeMobileRelease,
  manifest: NativeMobileManifest
) {
  if (release.draft || release.prerelease) return null;
  const names = expectedAssetNames(release.tag_name);
  if (!names || manifest.channel !== "native_mobile" || manifest.version_name !== names.version ||
      manifest.package_name !== NATIVE_MOBILE_EXPECTED_PACKAGE ||
      manifest.asset_name !== names.apk || manifest.min_sdk > 26 ||
      manifest.min_sdk < 21 ||
      manifest.signing_cert_sha256.toLowerCase() !== NATIVE_MOBILE_RELEASE_CERT_SHA256 ||
      manifest.source_repository !== "sstdevelopaminno/cpipos-native-pos" ||
      !/^[a-f0-9]{40}$/.test(manifest.source_commit) ||
      !Number.isSafeInteger(manifest.version_code) || manifest.version_code <= 0 ||
      !HEX_SHA256.test(manifest.sha256.toLowerCase())) return null;
  const apk = release.assets.find((a) => a.name === names.apk);
  if (!apk || !Number.isFinite(apk.size) || apk.size <= 0 ||
      apk.digest?.toLowerCase() !== `sha256:${manifest.sha256.toLowerCase()}`) return null;
  let parsed: URL;
  try { parsed = new URL(apk.browser_download_url); } catch { return null; }
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" ||
      parsed.pathname !== `/sstdevelopaminno/CpIPOS/releases/download/${release.tag_name}/${names.apk}`) return null;
  return {
    versionName: manifest.version_name,
    versionCode: manifest.version_code,
    packageName: manifest.package_name,
    apkUrl: apk.browser_download_url,
    apkSha256: manifest.sha256.toLowerCase(),
    apkSize: apk.size,
    signingCertSha256: NATIVE_MOBILE_RELEASE_CERT_SHA256,
    sourceCommit: manifest.source_commit
  };
}

export function nativeManifestAsset(release: NativeMobileRelease) {
  const names = expectedAssetNames(release.tag_name);
  const asset = names && release.assets.find((a) => a.name === names.manifest);
  if (!asset) return null;
  try {
    const url = new URL(asset.browser_download_url);
    if (url.protocol !== "https:" || url.hostname !== "github.com" ||
        url.pathname !== `/sstdevelopaminno/CpIPOS/releases/download/${release.tag_name}/${names!.manifest}`) return null;
    return url.toString();
  } catch { return null; }
}
