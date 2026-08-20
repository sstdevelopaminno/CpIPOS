import { NextResponse } from "next/server";

const RELEASE_API_URL = "https://api.github.com/repos/sstdevelopaminno/CpIPOS/releases/tags/android-runtime-latest";
const STABLE_ASSET_NAME = "CpIPOS-Android-POS.apk";
const VERSIONED_ASSET_PATTERN = /^CpIPOS-Android-POS-(\d+\.\d+\.\d+)\.apk$/;

export const dynamic = "force-dynamic";

type ReleaseAsset = {
  name?: string;
  size?: number;
  digest?: string | null;
  browser_download_url?: string;
};

type VersionedAsset = {
  version: string;
  asset: ReleaseAsset;
};

function parseVersion(value: string) {
  const parts = value.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return parts as [number, number, number];
}

function compareVersions(left: string, right: string) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function normalizeVersion(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && parseVersion(trimmed) ? trimmed : null;
}

function sameArtifact(left: ReleaseAsset | undefined, right: ReleaseAsset | undefined) {
  if (!left || !right) return false;
  if (left.digest && right.digest) return left.digest === right.digest;
  return Boolean(left.size && right.size && left.size === right.size);
}

function unavailable(reason: string) {
  return NextResponse.json(
    {
      ok: false,
      platform: "android-pos",
      forceUpdate: false,
      releaseReady: false,
      reason
    },
    {
      status: 503,
      headers: { "Cache-Control": "no-store" }
    }
  );
}

export async function GET() {
  try {
    const response = await fetch(RELEASE_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "CpIPOS-Android-Update-Policy"
      },
      next: { revalidate: 30 }
    });

    if (!response.ok) return unavailable("release_lookup_failed");

    const release = (await response.json()) as {
      updated_at?: string;
      assets?: ReleaseAsset[];
    };
    const assets = release.assets ?? [];
    const stableAsset = assets.find((asset) => asset.name === STABLE_ASSET_NAME);
    if (!stableAsset) return unavailable("stable_asset_missing");

    const versionedAssets: VersionedAsset[] = assets
      .map((asset) => {
        const match = asset.name?.match(VERSIONED_ASSET_PATTERN);
        return match ? { version: match[1], asset } : null;
      })
      .filter((item): item is VersionedAsset => Boolean(item))
      .sort((left, right) => compareVersions(right.version, left.version));

    const stableVersionedAsset = versionedAssets.find((item) => sameArtifact(item.asset, stableAsset));
    if (!stableVersionedAsset) return unavailable("stable_version_unresolved");

    const configuredRequiredVersion = normalizeVersion(process.env.CPIPOS_ANDROID_POS_REQUIRED_VERSION);
    const requiredVersion = configuredRequiredVersion ?? stableVersionedAsset.version;
    const releaseReady = compareVersions(stableVersionedAsset.version, requiredVersion) >= 0;

    // Legacy runtimes are permanently non-forced. Existing 1.0.12/1.0.13/1.0.15 stores
    // must continue operating unchanged. Modern runtimes use the capability-gated native
    // ManagedUpdateNotice flow instead, where the operator can choose Update now or Later.
    const forceUpdateEnabled = false;

    return NextResponse.json(
      {
        ok: true,
        platform: "android-pos",
        latestVersion: stableVersionedAsset.version,
        requiredVersion,
        forceUpdate: forceUpdateEnabled && releaseReady,
        releaseReady,
        downloadUrl: "/download/android/latest",
        stableAssetName: STABLE_ASSET_NAME,
        versionedAssetName: stableVersionedAsset.asset.name,
        releaseUpdatedAt: release.updated_at ?? null
      },
      {
        headers: { "Cache-Control": "no-store" }
      }
    );
  } catch {
    return unavailable("release_lookup_exception");
  }
}
