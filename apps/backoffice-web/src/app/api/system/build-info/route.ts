import { ok } from "@/lib/http";

const FALLBACK_BUILD_VERSION = "local-dev";

export function GET() {
  const commitSha =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.CF_PAGES_COMMIT_SHA ||
    null;

  const branch =
    process.env.VERCEL_GIT_COMMIT_REF ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF ||
    process.env.CF_PAGES_BRANCH ||
    null;

  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || process.env.NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID || null;

  return ok({
    build_version: commitSha || deploymentId || FALLBACK_BUILD_VERSION,
    commit_sha: commitSha,
    branch,
    deployment_id: deploymentId,
    runtime: process.env.VERCEL ? "vercel" : process.env.CF_PAGES ? "cloudflare_pages" : "local"
  });
}
