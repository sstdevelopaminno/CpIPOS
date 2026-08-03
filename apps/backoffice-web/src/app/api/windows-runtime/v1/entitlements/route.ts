import { NextResponse } from "next/server";
import { ok } from "@/lib/http";
import { buildRateLimitKey, enforceRateLimit, getClientIpAddress, readRateLimitSetting } from "@/lib/server/rate-limit";
import { buildWindowsRuntimeBootstrap, parseWindowsRuntimeRequest } from "@/lib/windows-runtime/entitlements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const rateLimited = await enforceWindowsRuntimeRateLimit(request, "windows_runtime_entitlements_get");
  if (rateLimited) return rateLimited;

  const payload = buildWindowsRuntimeBootstrap({});
  return ok(toEntitlementsResponse(payload));
}

export async function POST(request: Request) {
  const rateLimited = await enforceWindowsRuntimeRateLimit(request, "windows_runtime_entitlements_post");
  if (rateLimited) return rateLimited;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return NextResponse.json(
      { data: null, error: { code: "invalid_json", message: "Invalid Windows runtime entitlements JSON payload." } },
      { status: 400 }
    );
  }

  const payload = buildWindowsRuntimeBootstrap(parseWindowsRuntimeRequest(parsed.body));
  return ok(toEntitlementsResponse(payload));
}

function toEntitlementsResponse(payload: ReturnType<typeof buildWindowsRuntimeBootstrap>) {
  return {
    contract_version: payload.contract_version,
    server_time: payload.server_time,
    mode: payload.mode,
    license: payload.license,
    entitlements: payload.entitlements,
    sync: payload.sync,
    warnings: payload.warnings
  };
}

async function enforceWindowsRuntimeRateLimit(request: Request, namespace: string) {
  try {
    const clientIp = getClientIpAddress(request);
    const rateResult = await enforceRateLimit({
      namespace,
      key: buildRateLimitKey({ namespace: "windows-runtime", parts: [namespace, clientIp] }),
      max: readRateLimitSetting("WINDOWS_RUNTIME_RATE_LIMIT_MAX", 60, { min: 10, max: 1000 }),
      windowMs: readRateLimitSetting("POS_PUBLIC_RATE_LIMIT_WINDOW_SECONDS", 60, { min: 10, max: 3600 }) * 1000
    });

    if (rateResult.ok) return null;
    const response = NextResponse.json(
      { data: null, error: { code: "rate_limited", message: "Too many Windows runtime requests. Please retry later." } },
      { status: 429 }
    );
    response.headers.set("Retry-After", String(rateResult.retryAfterSeconds));
    return response;
  } catch (error) {
    console.error("[windows-runtime/entitlements] rate limit failed", {
      error: error instanceof Error ? error.message : "Unknown error"
    });
    return NextResponse.json(
      { data: null, error: { code: "rate_limit_unavailable", message: "Windows runtime entitlement checks are temporarily unavailable." } },
      { status: 503 }
    );
  }
}

async function readJsonBody(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  const text = await request.text();
  if (!text.trim()) return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}
