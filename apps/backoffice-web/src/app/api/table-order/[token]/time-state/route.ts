import { fail, ok } from "@/lib/http";
import { buildRateLimitKey, enforceRateLimit, getClientIpAddress } from "@/lib/server/rate-limit";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { normalizeTableQrPolicyFromMetadata } from "@/lib/table-qr-policy";
import { resolveTableQrContext } from "@/lib/table-qr-ordering";

const TIME_STATE_RATE_LIMIT_WINDOW_MS = 60_000;
const TIME_STATE_RATE_LIMIT_MAX = 120;

function closedLinkError(message: string) {
  return [
    "invalid_qr_token",
    "qr_session_expired",
    "table_session_closed",
    "table_not_available",
    "table_session_not_open",
    "table_not_open"
  ].some((code) => message.toLowerCase().includes(code));
}

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const sessionId = token.split(".", 1)[0]?.slice(0, 36) || "invalid";
  const rateLimit = await enforceRateLimit({
    namespace: "table_order_time_state",
    key: buildRateLimitKey({ namespace: "table-order", parts: [getClientIpAddress(request), sessionId, "time-state"] }),
    max: TIME_STATE_RATE_LIMIT_MAX,
    windowMs: TIME_STATE_RATE_LIMIT_WINDOW_MS,
    failClosedOnBackendError: true
  });

  if (!rateLimit.ok) {
    const response = rateLimit.source === "backend_unavailable"
      ? fail("rate_limit_unavailable", "ระบบตรวจสอบเวลาไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่", 503)
      : fail("rate_limited", "กรุณารอสักครู่แล้วลองใหม่", 429);
    if (rateLimit.retryAfterSeconds > 0) response.headers.set("retry-after", String(rateLimit.retryAfterSeconds));
    return response;
  }

  try {
    const qrContext = await resolveTableQrContext(token);
    const supabase = getSupabaseServiceClient();
    const { data: table, error } = await supabase
      .from("dining_tables")
      .select("metadata")
      .eq("tenant_id", qrContext.tenant_id)
      .eq("branch_id", qrContext.branch_id)
      .eq("id", qrContext.table_id)
      .maybeSingle<{ metadata: Record<string, unknown> | null }>();
    if (error) throw new Error(error.message);
    if (!table) throw new Error("table_not_available");

    const policy = normalizeTableQrPolicyFromMetadata(table.metadata);
    const response = ok({
      expiry_mode: policy.mode,
      ttl_minutes: policy.ttl_minutes,
      expires_at: qrContext.expires_at,
      server_time: new Date().toISOString()
    });
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "table_qr_time_state_failed";
    if (closedLinkError(message)) {
      const response = fail("table_order_link_expired", "หมดเวลาสั่งอาหารหรือบิลโต๊ะถูกปิดแล้ว", 410);
      response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
      return response;
    }
    console.error("[table-order-time-state] failed", { session_id_suffix: sessionId.slice(-8), message });
    const response = fail("table_qr_time_state_failed", "ไม่สามารถตรวจสอบเวลาคงเหลือได้ชั่วคราว", 503);
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return response;
  }
}
