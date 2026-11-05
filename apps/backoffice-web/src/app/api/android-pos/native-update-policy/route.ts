import { NextResponse } from "next/server";
import {
  nativeManifestAsset,
  validNativeMobileReleaseCandidates,
  verifiedNativeMobileUpdate,
  type NativeMobileManifest,
  type NativeMobileRelease
} from "@/lib/native-mobile-update-policy";

export const dynamic = "force-dynamic";

const RELEASES_URL = "https://api.github.com/repos/sstdevelopaminno/CpIPOS/releases?per_page=50";
const responseHeaders = { "Cache-Control": "private, no-store, max-age=0" };
function unavailable() {
  // A stale/offline update server must never block an existing cashier shift.
  return NextResponse.json({ ok: false, updateAvailable: false, reason: "stable_release_unverified" }, {
    status: 503, headers: responseHeaders
  });
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "CpIPOS-Native-Mobile-Update"
    },
    // Server-side cache shields the unauthenticated public update endpoint
    // from GitHub's 60 requests/hour IP limit. The client response itself
    // remains no-store; newly published stable releases appear within 1 min.
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error("update_metadata_not_available");
  return response.json();
}

export async function GET(request: Request) {
  try {
    const current = Number(new URL(request.url).searchParams.get("version_code") ?? "0");
    if (!Number.isSafeInteger(current) || current < 0) return NextResponse.json(
      { ok: false, updateAvailable: false, reason: "invalid_version_code" },
      { status: 422, headers: responseHeaders }
    );
    const raw = await getJson(RELEASES_URL);
    if (!Array.isArray(raw)) return unavailable();
    const candidates = validNativeMobileReleaseCandidates(raw as NativeMobileRelease[]);
    // Do not fall back to an older release if the latest stable release is malformed.
    const release = candidates[0];
    if (!release) return unavailable();
    const manifestUrl = nativeManifestAsset(release);
    if (!manifestUrl) return unavailable();
    const manifest = await getJson(manifestUrl) as NativeMobileManifest;
    const valid = verifiedNativeMobileUpdate(release, manifest);
    if (!valid) return unavailable();
    return NextResponse.json({
      ok: true,
      platform: "native-mobile-android",
      updateAvailable: valid.versionCode > current,
      autoDownload: true,
      forceUpdate: false,
      ...valid
    }, { headers: responseHeaders });
  } catch {
    return unavailable();
  }
}
