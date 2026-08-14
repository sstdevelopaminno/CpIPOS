import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { hashSecret, normalizeDisplayChannel } from "@/lib/customer-display-pairing";
import { fail, ok } from "@/lib/http";
import { invalidateRuntimeCacheByPrefix, readThroughRuntimeCache } from "@/lib/route-runtime-cache";
import {
  deactivateExpiredAndInactiveDevices,
  getCustomerDisplayPolicy
} from "@/lib/services/customer-display-policy-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type DisplayStateRow = {
  channel: string;
  payload: Record<string, unknown>;
  updated_at: string;
};

type DisplayReadScope = {
  tenantId: string;
  branchId: string;
  channel: string;
  source: "token" | "auth";
};

type DisplayWriteFingerprint = {
  signature: string;
  updatedAt: string;
  expiresAt: number;
};

const DISPLAY_WRITE_DEDUPE_MS = 30_000;
const DISPLAY_WRITE_DEDUPE_MAX_ENTRIES = 256;
const displayWriteFingerprints = new Map<string, DisplayWriteFingerprint>();

function displayPayloadSignature(payload: Record<string, unknown>) {
  const { updated_at: _ignoredUpdatedAt, ...stablePayload } = payload;
  return JSON.stringify(stablePayload);
}

function rememberDisplayWrite(key: string, signature: string, updatedAt: string) {
  const now = Date.now();
  for (const [entryKey, entry] of displayWriteFingerprints.entries()) {
    if (entry.expiresAt <= now) displayWriteFingerprints.delete(entryKey);
  }
  if (displayWriteFingerprints.size >= DISPLAY_WRITE_DEDUPE_MAX_ENTRIES) {
    const oldestKey = displayWriteFingerprints.keys().next().value as string | undefined;
    if (oldestKey) displayWriteFingerprints.delete(oldestKey);
  }
  displayWriteFingerprints.set(key, {
    signature,
    updatedAt,
    expiresAt: now + DISPLAY_WRITE_DEDUPE_MS
  });
}

function isSchemaMissingError(message: string): boolean {
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

async function resolveReadScope(req: Request): Promise<DisplayReadScope> {
  const supabase = getSupabaseServiceClient();
  const url = new URL(req.url);
  const requestedChannel = normalizeDisplayChannel(url.searchParams.get("channel"));
  const tokenFromHeader = req.headers.get("x-customer-display-token");
  const tokenFromQuery = url.searchParams.get("token");
  const rawToken = String(tokenFromHeader ?? tokenFromQuery ?? "").trim();

  if (rawToken) {
    const tokenHash = hashSecret(rawToken);
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("pos_customer_display_pairings")
      .select("id,tenant_id,branch_id,channel,device_token_expires_at,last_seen_at,is_active")
      .eq("device_token_hash", tokenHash)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle<{
        id: string;
        tenant_id: string;
        branch_id: string;
        channel: string;
        device_token_expires_at: string | null;
        last_seen_at: string | null;
        is_active: boolean;
      }>();

    if (error) {
      if (isSchemaMissingError(error.message)) {
        throw new Error("customer_display_unavailable");
      }
      throw new Error(`customer_display_pairing_lookup_failed:${error.message}`);
    }
    if (!data || !data.device_token_expires_at || new Date(data.device_token_expires_at).getTime() <= Date.now()) {
      throw new Error("customer_display_pairing_invalid");
    }
    const tokenChannel = normalizeDisplayChannel(data.channel);
    const scope = {
      tenantId: data.tenant_id,
      branchId: data.branch_id,
      channel: tokenChannel
    };
    const policy = await getCustomerDisplayPolicy(supabase, scope);
    await deactivateExpiredAndInactiveDevices({
      supabase,
      scope,
      policy
    });
    if (data.last_seen_at) {
      const staleCutoff = Date.now() - policy.inactiveExpireHours * 60 * 60 * 1000;
      if (new Date(data.last_seen_at).getTime() < staleCutoff) {
        await supabase.from("pos_customer_display_pairings").update({ is_active: false }).eq("id", data.id);
        throw new Error("customer_display_pairing_invalid");
      }
    }
    if (requestedChannel && requestedChannel !== tokenChannel) {
      throw new Error("customer_display_pairing_channel_forbidden");
    }

    void (async () => {
      await supabase
        .from("pos_customer_display_pairings")
        .update({ last_seen_at: nowIso })
        .eq("id", data.id);
    })();

    return {
      tenantId: data.tenant_id,
      branchId: data.branch_id,
      channel: tokenChannel,
      source: "token"
    };
  }

  const auth = await getPosApiAuthContext({
    requireBranchScope: true,
    requiredPermission: "customer_display:view"
  });
  await requirePosApiFeature(auth, "customer_facing_display");
  return {
    tenantId: auth.tenantId!,
    branchId: auth.branchId!,
    channel: requestedChannel,
    source: "auth"
  };
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  try {
    const scope = await resolveReadScope(req);
    await requirePosApiFeature({ tenantId: scope.tenantId, branchId: scope.branchId }, "customer_facing_display");
    const supabase = getSupabaseServiceClient();
    const cacheKey = `pos-customer-display:${scope.tenantId}:${scope.branchId}:${scope.channel}`;

    const { value: data, source: cacheSource } = await readThroughRuntimeCache<DisplayStateRow | null>({
      key: cacheKey,
      ttlMs: 500,
      staleIfErrorMs: 5000,
      loader: async () => {
        const { data: row, error } = await supabase
          .from("pos_customer_display_states")
          .select("channel,payload,updated_at")
          .eq("tenant_id", scope.tenantId)
          .eq("branch_id", scope.branchId)
          .eq("channel", scope.channel)
          .maybeSingle<DisplayStateRow>();

        if (error) {
          if (isSchemaMissingError(error.message)) {
            return null;
          }
          throw new Error(`customer_display_state_query_failed:${error.message}`);
        }
        return row ?? null;
      }
    });

    const response = ok({
      channel: scope.channel,
      scope: scope.source,
      data
    });
    response.headers.set("x-pos-customer-display-cache", cacheSource);
    response.headers.set("x-pos-customer-display-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) {
      featureError.headers.set("x-pos-customer-display-ms", String(Date.now() - startedAt));
      return featureError;
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "customer_display_pairing_invalid") {
      const response = fail("customer_display_pairing_invalid", "Pairing token is invalid or expired.", 401);
      response.headers.set("x-pos-customer-display-ms", String(Date.now() - startedAt));
      return response;
    }
    if (message === "customer_display_pairing_channel_forbidden") {
      const response = fail("customer_display_pairing_channel_forbidden", "This device is not allowed to read requested channel.", 403);
      response.headers.set("x-pos-customer-display-ms", String(Date.now() - startedAt));
      return response;
    }
    if (message === "customer_display_unavailable") {
      const response = fail(
        "customer_display_unavailable",
        "Customer display database tables are not ready. Run latest migrations and refresh schema cache.",
        503
      );
      response.headers.set("x-pos-customer-display-ms", String(Date.now() - startedAt));
      return response;
    }
    if (message.startsWith("customer_display_pairing_lookup_failed:")) {
      const response = fail("customer_display_pairing_lookup_failed", message.slice("customer_display_pairing_lookup_failed:".length), 500);
      response.headers.set("x-pos-customer-display-ms", String(Date.now() - startedAt));
      return response;
    }
    if (message.includes("not authenticated") || message.includes("authenticated")) {
      const response = fail("unauthorized", message, 401);
      response.headers.set("x-pos-customer-display-ms", String(Date.now() - startedAt));
      return response;
    }
    const response = fail("pos_customer_display_fetch_failed", message, 500);
    response.headers.set("x-pos-customer-display-ms", String(Date.now() - startedAt));
    return response;
  }
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const auth = await getPosApiAuthContext({
      requireBranchScope: true,
      requiredPermission: "customer_display:manage"
    });
    await requirePosApiFeature(auth, "customer_facing_display");
    const supabase = getSupabaseServiceClient();
    const body = (await req.json().catch(() => null)) as {
      channel?: string;
      payload?: Record<string, unknown>;
    } | null;

    if (!body || typeof body !== "object") {
      const response = fail("invalid_json", "Request body must be valid JSON.", 400);
      response.headers.set("x-pos-customer-display-ms", String(Date.now() - startedAt));
      return response;
    }

    const channel = normalizeDisplayChannel(body.channel ?? null);
    const payload = body.payload && typeof body.payload === "object" ? body.payload : null;
    if (!payload) {
      const response = fail("invalid_payload", "payload object is required.", 422);
      response.headers.set("x-pos-customer-display-ms", String(Date.now() - startedAt));
      return response;
    }

    const dedupeKey = `${auth.tenantId}:${auth.branchId}:${channel}`;
    const signature = displayPayloadSignature(payload);
    const rememberedWrite = displayWriteFingerprints.get(dedupeKey);
    if (rememberedWrite && rememberedWrite.expiresAt > Date.now() && rememberedWrite.signature === signature) {
      const response = ok({
        channel,
        updated_at: rememberedWrite.updatedAt,
        fallback_mode: false,
        duplicate: true
      });
      response.headers.set("x-pos-customer-display-write", "deduped");
      response.headers.set("x-pos-customer-display-ms", String(Date.now() - startedAt));
      return response;
    }

    const updatedAt = new Date().toISOString();
    const { error } = await supabase.from("pos_customer_display_states").upsert(
      {
        tenant_id: auth.tenantId!,
        branch_id: auth.branchId!,
        channel,
        payload,
        updated_by: auth.userId,
        updated_at: updatedAt
      },
      { onConflict: "tenant_id,branch_id,channel" }
    );

    if (error && !isSchemaMissingError(error.message)) {
      const response = fail("pos_customer_display_update_failed", error.message, 500);
      response.headers.set("x-pos-customer-display-ms", String(Date.now() - startedAt));
      return response;
    }

    rememberDisplayWrite(dedupeKey, signature, updatedAt);
    invalidateRuntimeCacheByPrefix(`pos-customer-display:${auth.tenantId}:${auth.branchId}:${channel}`);

    const response = ok({
      channel,
      updated_at: updatedAt,
      fallback_mode: Boolean(error && isSchemaMissingError(error.message)),
      duplicate: false
    });
    response.headers.set("x-pos-customer-display-write", "upsert");
    response.headers.set("x-pos-customer-display-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) {
      featureError.headers.set("x-pos-customer-display-ms", String(Date.now() - startedAt));
      return featureError;
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    const authError = message.toLowerCase().includes("authenticated") || message.toLowerCase().includes("unauthorized");
    const response = fail(authError ? "unauthorized" : "pos_customer_display_post_failed", message, authError ? 401 : 500);
    response.headers.set("x-pos-customer-display-ms", String(Date.now() - startedAt));
    return response;
  }
}
