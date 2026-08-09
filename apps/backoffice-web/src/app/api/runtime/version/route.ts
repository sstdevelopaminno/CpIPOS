export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0"
};

function resolveRuntimeVersion() {
  return (
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.VERCEL_DEPLOYMENT_ID ||
    process.env.VERCEL_GIT_COMMIT_REF ||
    "local-development"
  );
}

export async function GET() {
  return Response.json(
    { version: resolveRuntimeVersion() },
    { headers: NO_STORE_HEADERS }
  );
}
