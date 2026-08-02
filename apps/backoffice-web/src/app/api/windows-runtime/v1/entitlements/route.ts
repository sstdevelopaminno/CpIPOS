import { ok } from "@/lib/http";
import { buildWindowsRuntimeBootstrap, parseWindowsRuntimeRequest } from "@/lib/windows-runtime/entitlements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const payload = buildWindowsRuntimeBootstrap({});
  return ok({
    contract_version: payload.contract_version,
    server_time: payload.server_time,
    mode: payload.mode,
    license: payload.license,
    entitlements: payload.entitlements,
    sync: payload.sync,
    warnings: payload.warnings
  });
}

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const payload = buildWindowsRuntimeBootstrap(parseWindowsRuntimeRequest(body));
  return ok({
    contract_version: payload.contract_version,
    server_time: payload.server_time,
    mode: payload.mode,
    license: payload.license,
    entitlements: payload.entitlements,
    sync: payload.sync,
    warnings: payload.warnings
  });
}
