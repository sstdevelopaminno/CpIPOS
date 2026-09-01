import { buildCustomerDisplayV2Channel } from "@/lib/customer-display-v2";
import { fail, ok } from "@/lib/http";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { readThroughRuntimeCache } from "@/lib/route-runtime-cache";
import { BoundedTimeoutError, readBoundedTimeoutMs } from "@/lib/server/bounded-timeout";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export const maxDuration = 10;

type DisplayStateRow = {
  channel: string;
  payload: Record<string, unknown>;
  updated_at: string;
};

const NATIVE_STATE_TIMEOUT_MS = readBoundedTimeoutMs("POS_CUSTOMER_DISPLAY_NATIVE_TIMEOUT_MS", 2_500, 500, 8_000);

function isSchemaMissingError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("does not exist") ||
    normalized.includes("pgrst") ||
    normalized.includes("undefined table") ||
    normalized.includes("schema cache") ||
    normalized.includes("could not find the table")
  );
}

export async function GET() {
  const startedAt = Date.now();
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "sale:create");
    await requirePosApiFeature(
      { tenantId: scope.session.tenant_id, branchId: scope.session.branch_id },
      "customer_facing_display"
    );

    const deviceId = String(scope.session.device_id ?? "").trim() || null;
    const deviceCode = String(scope.session.device_code ?? "").trim() || null;
    if (!deviceId && !deviceCode) {
      const response = fail(
        "customer_display_v2_device_required",
        "POS session must be bound to a device before reading native Customer Display V2 state.",
        409
      );
      response.headers.set("x-pos-customer-display-v2-native-ms", String(Date.now() - startedAt));
      return response;
    }

    const channel = buildCustomerDisplayV2Channel({ id: deviceId, code: deviceCode });
    const supabase = getSupabaseServiceClient();
    const cacheKey = `pos-customer-display:${scope.session.tenant_id}:${scope.session.branch_id}:${channel}`;
    const { value: data, source } = await readThroughRuntimeCache<DisplayStateRow | null>({
      key: cacheKey,
      ttlMs: 15_000,
      staleIfErrorMs: 60_000,
      loaderTimeoutMs: NATIVE_STATE_TIMEOUT_MS,
      timeoutCode: "customer_display_v2_native_query_timeout",
      loader: async (signal) => {
        const { data: row, error } = await supabase
          .from("pos_customer_display_states")
          .select("channel,payload,updated_at")
          .eq("tenant_id", scope.session.tenant_id)
          .eq("branch_id", scope.session.branch_id)
          .eq("channel", channel)
          .abortSignal(signal!)
          .maybeSingle<DisplayStateRow>();

        if (error) {
          if (signal?.aborted) throw new BoundedTimeoutError("customer_display_v2_native_query_timeout", NATIVE_STATE_TIMEOUT_MS);
          if (isSchemaMissingError(error.message)) return null;
          throw new Error(`customer_display_v2_native_query_failed:${error.message}`);
        }
        return row ?? null;
      }
    });

    const response = ok({
      channel,
      device_id: deviceId,
      device_code: deviceCode,
      data
    });
    // Session/device scoped state must never be public-CDN cached.
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("x-pos-customer-display-cache", source);
    response.headers.set("x-pos-customer-display-v2-native-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) {
      featureError.headers.set("x-pos-customer-display-v2-native-ms", String(Date.now() - startedAt));
      return featureError;
    }
    if (error instanceof PosGuardError) {
      const response = fail(error.code, error.message, error.status);
      response.headers.set("x-pos-customer-display-v2-native-ms", String(Date.now() - startedAt));
      return response;
    }
    if (error instanceof BoundedTimeoutError) {
      const response = fail(error.code, "Customer Display V2 native state timed out. Please retry.", 504);
      response.headers.set("x-pos-customer-display-v2-native-ms", String(Date.now() - startedAt));
      return response;
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    const response = fail("customer_display_v2_native_fetch_failed", message, 500);
    response.headers.set("x-pos-customer-display-v2-native-ms", String(Date.now() - startedAt));
    return response;
  }
}
