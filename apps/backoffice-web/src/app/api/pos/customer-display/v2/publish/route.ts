import { buildCustomerDisplayV2Channel, type CustomerDisplayV2Payload } from "@/lib/customer-display-v2";
import { fail, ok } from "@/lib/http";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { invalidateRuntimeCacheByPrefix } from "@/lib/route-runtime-cache";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

const MAX_IMAGE_SOURCE_LENGTH = 2_000_000;
const MAX_QR_SOURCE_LENGTH = 1_000_000;

function isSchemaMissingError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("does not exist") ||
    normalized.includes("pgrst") ||
    normalized.includes("undefined table") ||
    normalized.includes("undefined column") ||
    normalized.includes("schema cache") ||
    normalized.includes("could not find the table")
  );
}

function normalizeText(value: unknown, max = 180) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

function normalizeImageSource(value: unknown, maxLength = MAX_IMAGE_SOURCE_LENGTH) {
  const source = String(value ?? "").trim();
  if (!source || source.length > maxLength) return null;
  if (source.startsWith("https://") || source.startsWith("http://") || source.startsWith("data:image/")) {
    return source;
  }
  return null;
}

function normalizeMoney(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function normalizeOptionalMoney(value: unknown) {
  return value == null ? null : normalizeMoney(value);
}

function normalizePayload(raw: unknown): CustomerDisplayV2Payload | null {
  if (!raw || typeof raw !== "object") return null;
  const input = raw as Partial<CustomerDisplayV2Payload>;
  if (input.version !== 2) return null;
  if (input.phase !== "idle" && input.phase !== "cart" && input.phase !== "cash" && input.phase !== "qr" && input.phase !== "paid") {
    return null;
  }

  const rawItems = Array.isArray(input.items) ? input.items.slice(0, 200) : [];
  const items = rawItems.map((item) => ({
    product_id: String(item?.product_id ?? "").trim().slice(0, 120),
    name: String(item?.name ?? "").trim().slice(0, 240),
    quantity: normalizeMoney(item?.quantity),
    price: normalizeMoney(item?.price),
    notes: normalizeText(item?.notes, 500)
  }));
  const mediaUrls = Array.isArray(input.media_urls)
    ? input.media_urls
        .map((value) => normalizeImageSource(value))
        .filter((value): value is string => Boolean(value))
        .slice(0, 20)
    : [];

  return {
    version: 2,
    phase: input.phase,
    store_name: String(input.store_name ?? "CpIPOS").trim().slice(0, 240) || "CpIPOS",
    store_logo_url: normalizeImageSource(input.store_logo_url),
    branch_name: normalizeText(input.branch_name, 240),
    device_id: normalizeText(input.device_id, 120),
    device_code: normalizeText(input.device_code, 120),
    device_name: normalizeText(input.device_name, 240),
    order_no: normalizeText(input.order_no, 120),
    items,
    subtotal_amount: normalizeOptionalMoney(input.subtotal_amount),
    discount_amount: normalizeOptionalMoney(input.discount_amount),
    total_amount: normalizeMoney(input.total_amount),
    cash_received: input.cash_received == null ? null : normalizeMoney(input.cash_received),
    change_amount: input.change_amount == null ? null : normalizeMoney(input.change_amount),
    payment_method: input.payment_method === "cash" || input.payment_method === "bank_transfer" ? input.payment_method : null,
    payment_qr_url: normalizeImageSource(input.payment_qr_url, MAX_QR_SOURCE_LENGTH),
    media_urls: mediaUrls,
    last_activity_at: normalizeText(input.last_activity_at, 64) ?? new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "sale:create");
    await requirePosApiFeature(
      { tenantId: scope.session.tenant_id, branchId: scope.session.branch_id },
      "customer_facing_display"
    );

    const body = (await req.json().catch(() => null)) as { payload?: unknown } | null;
    const payload = normalizePayload(body?.payload);
    if (!payload) {
      const response = fail("invalid_customer_display_v2_payload", "A valid Customer Display V2 payload is required.", 422);
      response.headers.set("x-pos-customer-display-v2-ms", String(Date.now() - startedAt));
      return response;
    }

    const deviceId = normalizeText(scope.session.device_id, 120);
    const deviceCode = normalizeText(scope.session.device_code, 120);
    if (!deviceId && !deviceCode) {
      const response = fail("customer_display_v2_device_required", "POS session must be bound to a device before publishing Customer Display V2 state.", 409);
      response.headers.set("x-pos-customer-display-v2-ms", String(Date.now() - startedAt));
      return response;
    }

    const channel = buildCustomerDisplayV2Channel({ id: deviceId, code: deviceCode });
    const stampedPayload: CustomerDisplayV2Payload = {
      ...payload,
      branch_name: scope.branch?.name ?? payload.branch_name,
      device_id: deviceId,
      device_code: deviceCode,
      device_name: payload.device_name || deviceCode,
      updated_at: new Date().toISOString()
    };

    const supabase = getSupabaseServiceClient();
    const { error } = await supabase.from("pos_customer_display_states").upsert(
      {
        tenant_id: scope.session.tenant_id,
        branch_id: scope.session.branch_id,
        channel,
        payload: stampedPayload,
        updated_by: scope.session.user_id,
        updated_at: stampedPayload.updated_at
      },
      { onConflict: "tenant_id,branch_id,channel" }
    );

    if (error) {
      const unavailable = isSchemaMissingError(error.message);
      const response = fail(
        unavailable ? "customer_display_unavailable" : "customer_display_v2_publish_failed",
        unavailable ? "Customer display database tables are not ready." : error.message,
        unavailable ? 503 : 500
      );
      response.headers.set("x-pos-customer-display-v2-ms", String(Date.now() - startedAt));
      return response;
    }

    invalidateRuntimeCacheByPrefix(`pos-customer-display:${scope.session.tenant_id}:${scope.session.branch_id}:${channel}`);
    const response = ok({ channel, updated_at: stampedPayload.updated_at });
    response.headers.set("x-pos-customer-display-v2-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) {
      featureError.headers.set("x-pos-customer-display-v2-ms", String(Date.now() - startedAt));
      return featureError;
    }
    if (error instanceof PosGuardError) {
      const response = fail(error.code, error.message, error.status);
      response.headers.set("x-pos-customer-display-v2-ms", String(Date.now() - startedAt));
      return response;
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    const response = fail("customer_display_v2_publish_failed", message, 500);
    response.headers.set("x-pos-customer-display-v2-ms", String(Date.now() - startedAt));
    return response;
  }
}
