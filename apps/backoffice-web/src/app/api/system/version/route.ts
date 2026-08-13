import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

const SOURCE_VERSIONS = {
  windows_runtime: "0.1.8",
  android_pos: "1.0.7",
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

  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}
