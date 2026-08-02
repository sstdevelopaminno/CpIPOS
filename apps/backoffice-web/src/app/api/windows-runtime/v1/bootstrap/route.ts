import { ok } from "@/lib/http";
import { buildWindowsRuntimeBootstrap, parseWindowsRuntimeRequest } from "@/lib/windows-runtime/entitlements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return ok(buildWindowsRuntimeBootstrap({}));
}

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  return ok(buildWindowsRuntimeBootstrap(parseWindowsRuntimeRequest(body)));
}
