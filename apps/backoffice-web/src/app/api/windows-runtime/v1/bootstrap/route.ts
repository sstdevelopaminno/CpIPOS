import { NextResponse } from "next/server";
import { ok } from "@/lib/http";
import { buildRateLimitKey, enforceRateLimit, getClientIpAddress, readRateLimitSetting } from "@/lib/server/rate-limit";
import { buildWindowsRuntimeBootstrap, parseWindowsRuntimeRequest } from "@/lib/windows-runtime/entitlements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const rateLimited = await enforceWindowsRuntimeRateLimit(request, "windows_runtime_bootstrap_get");
  if (rateLimited) return rateLimited;
  return ok(buildWindowsRuntimeBootstrap({}));
}

export async function POST(request: Request) {
  const rateLimited = await enforceWindowsRuntimeRateLimit(request, "windows_runtime_bootstrap_post");
  if (rateLimited) return rateLimited;

  const parsed = await readJsonBody(request);
  if (!parsed.ok) {
    return NextResponse.json(
      { data: null, error: { code: "invalid_json", message: "Invalid Windows runtime bootstrap JSON payload." } },
      { status: 400 }
    );
  }

  return ok(buildWindowsRuntimeBootstrap(parseWindowsRuntimeRequest(parsed.body)));
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
    console.error("[windows-runtime/bootstrap] rate limit failed", {
      error: error instanceof Error ? error.message : "Unknown error"
    });
    return NextResponse.json(
      { data: null, error: { code: "rate_limit_unavailable", message: "Windows runtime activation is temporarily unavailable." } },
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
