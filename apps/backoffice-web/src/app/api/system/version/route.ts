import { ok } from "@/lib/http";
import { ANDROID_MODERN_RELEASE } from "@/lib/android-runtime-release";

export const dynamic = "force-dynamic";
export const maxDuration = 5;

const SOURCE_VERSIONS = {
  windows_runtime: "0.1.8",
  android_pos: ANDROID_MODERN_RELEASE.versionName,
  hotfix: "receipt-speed-payment-notice-printer-ui-2026-08-13"
} as const;

export async function GET() {
  const response = ok({
    web: {
      commit_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null,
      commit_ref: process.env.VERCEL_GIT_COMMIT_REF ?? process.env.GITHUB_REF_NAME ?? null,
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null
    },
    source_versions: SOURCE_VERSIONS,
    generated_at: new Date().toISOString()
  });

  // Shared deployment metadata is safe to serve from the edge. Browser reuse also reduces
  // Edge Requests, while stale-while-revalidate prevents a cache miss stampede after expiry.
  response.headers.set("Cache-Control", "public, max-age=30, s-maxage=60, stale-while-revalidate=300");
  return response;
}
