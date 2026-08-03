import { NextResponse } from "next/server";
import { ok } from "@/lib/http";
import { buildRateLimitKey, enforceRateLimit, getClientIpAddress, readRateLimitSetting } from "@/lib/server/rate-limit";
import { buildWindowsRuntimeBootstrap } from "@/lib/windows-runtime/entitlements";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const rateLimited = await enforceWindowsRuntimeRateLimit(request);
  if (rateLimited) return rateLimited;

  const payload = buildWindowsRuntimeBootstrap({});
  return ok({
    contract_version: payload.contract_version,
    server_time: payload.server_time,
    sync: {
      ...payload.sync,
      phase: "offline_database_foundation",
      live_order_sync: "not_enabled_yet",
      live_payment_sync: "not_enabled_yet",
      live_catalog_pull: "not_enabled_yet",
      safety_reason: "Offline order/payment writes stay disabled until signed activation, idempotency, conflict handling, and server package validation are implemented and tested.",
      next_required_endpoints: [
        "POST /api/windows-runtime/v1/sync/orders",
        "POST /api/windows-runtime/v1/sync/payments",
        "POST /api/windows-runtime/v1/sync/print-jobs",
        "GET /api/windows-runtime/v1/sync/pull-catalog"
      ]
    }
  });
}

async function enforceWindowsRuntimeRateLimit(request: Request) {
  try {
    const clientIp = getClientIpAddress(request);
    const rateResult = await enforceRateLimit({
      namespace: "windows_runtime_sync_status_get",
      key: buildRateLimitKey({ namespace: "windows-runtime", parts: ["sync-status", clientIp] }),
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
    console.error("[windows-runtime/sync/status] rate limit failed", {
      error: error instanceof Error ? error.message : "Unknown error"
    });
    return NextResponse.json(
      { data: null, error: { code: "rate_limit_unavailable", message: "Windows runtime sync status is temporarily unavailable." } },
      { status: 503 }
    );
  }
}
