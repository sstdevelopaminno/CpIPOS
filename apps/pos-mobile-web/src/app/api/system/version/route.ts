import { ok } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const deploymentId = process.env.VERCEL_DEPLOYMENT_ID || null;
  const commit = process.env.VERCEL_GIT_COMMIT_SHA || null;
  return ok({
    version: commit?.slice(0, 7) || deploymentId?.replace(/^dpl_/, "").slice(0, 7) || process.env.NEXT_PUBLIC_APP_VERSION || "local",
    commit,
    branch: process.env.VERCEL_GIT_COMMIT_REF || null,
    environment: process.env.VERCEL_ENV || "local",
    deploymentId,
  });
}
