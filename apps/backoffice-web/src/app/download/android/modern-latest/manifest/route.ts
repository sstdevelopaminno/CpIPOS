import { NextResponse } from "next/server";
import {
  ANDROID_MODERN_RELEASE,
  ANDROID_UPDATE_SIGNING_CERT_SHA256
} from "@/lib/android-runtime-release";

const releaseApiUrl = `https://api.github.com/repos/sstdevelopaminno/CpIPOS/releases/tags/${ANDROID_MODERN_RELEASE.releaseTag}`;

export const dynamic = "force-dynamic";

type ReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function normalizeSha256(value: unknown) {
  return String(value ?? "").trim().toLowerCase().replaceAll(":", "");
}

function unavailable(code: string) {
  return NextResponse.json({
    data: null,
    error: { code, message: `Android Modern ${ANDROID_MODERN_RELEASE.versionName} update manifest is not ready.` }
  }, {
    status: 503,
    headers: { "Cache-Control": "no-store" }
  });
}

export async function GET() {
  try {
    const releaseResponse = await fetch(releaseApiUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "CpIPOS-AndroidModernRuntime-Manifest"
      }
    });
    if (!releaseResponse.ok) return unavailable("modern_release_not_ready");

    const release = await releaseResponse.json() as { assets?: ReleaseAsset[] };
    const manifestAsset = release.assets?.find(
      (asset) => asset.name === ANDROID_MODERN_RELEASE.manifestAssetName && Boolean(asset.browser_download_url)
    );
    if (!manifestAsset?.browser_download_url) return unavailable("modern_manifest_asset_missing");

    const manifestResponse = await fetch(manifestAsset.browser_download_url, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "CpIPOS-AndroidModernRuntime-Manifest"
      }
    });
    if (!manifestResponse.ok) return unavailable("modern_manifest_download_failed");

    const raw = asRecord(await manifestResponse.json().catch(() => null));
    const versionName = String(raw.version_name ?? "").trim();
    const versionCode = Number(raw.version_code);
    const packageName = String(raw.package_name ?? "").trim();
    const channel = String(raw.channel ?? "").trim().toLowerCase();
    const assetName = String(raw.asset_name ?? "").trim();
    const sha256 = normalizeSha256(raw.sha256);
    const signingCertSha256 = normalizeSha256(raw.signing_cert_sha256);

    if (versionName !== ANDROID_MODERN_RELEASE.versionName || versionCode !== ANDROID_MODERN_RELEASE.versionCode) {
      return unavailable("modern_manifest_version_mismatch");
    }
    if (packageName !== "com.cpipos.pos" || channel !== ANDROID_MODERN_RELEASE.channel) {
      return unavailable("modern_manifest_identity_mismatch");
    }
    if (assetName !== ANDROID_MODERN_RELEASE.assetName || !/^[0-9a-f]{64}$/.test(sha256)) {
      return unavailable("modern_manifest_asset_invalid");
    }
    if (signingCertSha256 !== ANDROID_UPDATE_SIGNING_CERT_SHA256) {
      return unavailable("modern_manifest_signing_mismatch");
    }

    return NextResponse.json({
      version_name: versionName,
      version_code: versionCode,
      package_name: packageName,
      channel,
      asset_name: assetName,
      sha256,
      signing_cert_sha256: signingCertSha256,
      download_url: ANDROID_MODERN_RELEASE.downloadUrl
    }, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-CpIPOS-Android-Version": versionName,
        "X-CpIPOS-Android-Version-Code": String(versionCode),
        "X-CpIPOS-Android-Channel": channel
      }
    });
  } catch {
    return unavailable("modern_manifest_unavailable");
  }
}
