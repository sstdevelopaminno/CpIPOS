import { POST as resolveStore } from "@/app/api/store/resolve/route";

// Reuse the canonical store resolver in-process. This preserves the same
// validation, rate limiting, tenant/branch/device-policy lookup, and response
// contract without a serverless request calling back into the same deployment.
export async function POST(request: Request) {
  return resolveStore(request);
}