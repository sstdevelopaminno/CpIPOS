import "server-only";

import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type TenantDataHome = "primary" | "trial" | "archive";
export type TenantLifecycleStatus = "sales_demo" | "trial" | "active" | "grace" | "suspended" | "expired" | "migrating" | "archived";
export type TenantMigrationStatus = "idle" | "planned" | "copying" | "verifying" | "cutover" | "complete" | "failed";

export type TenantDataRoute = {
  tenantId: string;
  lifecycleStatus: TenantLifecycleStatus;
  dataHome: TenantDataHome;
  desiredDataHome: TenantDataHome;
  migrationStatus: TenantMigrationStatus;
  routingVersion: number;
};

type LifecycleRow = {
  tenant_id: string;
  lifecycle_status: TenantLifecycleStatus;
  data_home: TenantDataHome;
  desired_data_home: TenantDataHome;
  migration_status: TenantMigrationStatus;
  routing_version: number;
};

type TrialClient = ReturnType<typeof createTrialServiceClient>;

type TenantDataRouteCacheEntry = {
  value: TenantDataRoute;
  expiresAt: number;
};

const TENANT_DATA_ROUTE_CACHE_TTL_MS = 30_000;

declare global {
  var __posTrialSupabaseServiceClient: TrialClient | undefined;
  var __tenantDataRouteCache: Map<string, TenantDataRouteCacheEntry> | undefined;
  var __tenantDataRouteInFlight: Map<string, Promise<TenantDataRoute>> | undefined;
}

function readBooleanEnv(name: string, fallback = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function isTrialDataRoutingConfigured() {
  return Boolean(
    readBooleanEnv("TRIAL_DATA_ROUTING_ENABLED", false) &&
      String(process.env.TRIAL_SUPABASE_URL ?? "").trim() &&
      String(process.env.TRIAL_SUPABASE_SERVICE_ROLE_KEY ?? "").trim()
  );
}

function createTrialServiceClient() {
  if (typeof window !== "undefined") {
    throw new Error("Trial Supabase service client can only be used on the server.");
  }

  const url = String(process.env.TRIAL_SUPABASE_URL ?? "").trim();
  const key = String(process.env.TRIAL_SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!readBooleanEnv("TRIAL_DATA_ROUTING_ENABLED", false) || !url || !key) {
    throw new Error("trial_data_route_unavailable");
  }
  if (!url.startsWith("https://")) {
    throw new Error("trial_supabase_url_must_use_https");
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      headers: {
        "x-cpipos-data-home": "trial"
      }
    }
  });
}

function getTrialServiceClient() {
  if (globalThis.__posTrialSupabaseServiceClient) {
    return globalThis.__posTrialSupabaseServiceClient;
  }
  globalThis.__posTrialSupabaseServiceClient = createTrialServiceClient();
  return globalThis.__posTrialSupabaseServiceClient;
}

function getTenantDataRouteCache() {
  if (!globalThis.__tenantDataRouteCache) {
    globalThis.__tenantDataRouteCache = new Map<string, TenantDataRouteCacheEntry>();
  }
  return globalThis.__tenantDataRouteCache;
}

function getTenantDataRouteInFlight() {
  if (!globalThis.__tenantDataRouteInFlight) {
    globalThis.__tenantDataRouteInFlight = new Map<string, Promise<TenantDataRoute>>();
  }
  return globalThis.__tenantDataRouteInFlight;
}

function readCachedTenantDataRoute(tenantId: string) {
  const cache = getTenantDataRouteCache();
  const cached = cache.get(tenantId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    cache.delete(tenantId);
    return null;
  }
  return cached.value;
}

function writeCachedTenantDataRoute(tenantId: string, value: TenantDataRoute) {
  getTenantDataRouteCache().set(tenantId, {
    value,
    expiresAt: Date.now() + TENANT_DATA_ROUTE_CACHE_TTL_MS
  });
}

export function invalidateTenantDataRouteCache(tenantId?: string | null) {
  const cache = getTenantDataRouteCache();
  const inFlight = getTenantDataRouteInFlight();
  if (!tenantId) {
    cache.clear();
    inFlight.clear();
    return;
  }
  cache.delete(tenantId);
  inFlight.delete(tenantId);
}

async function loadTenantDataRoute(tenantId: string): Promise<TenantDataRoute> {
  const primary = getSupabaseServiceClient();
  const { data, error } = await primary
    .from("tenant_data_lifecycle")
    .select("tenant_id,lifecycle_status,data_home,desired_data_home,migration_status,routing_version")
    .eq("tenant_id", tenantId)
    .maybeSingle<LifecycleRow>();

  if (error) {
    throw new Error(`tenant_data_route_lookup_failed:${error.message}`);
  }

  if (!data) {
    return {
      tenantId,
      lifecycleStatus: "active",
      dataHome: "primary",
      desiredDataHome: "primary",
      migrationStatus: "idle",
      routingVersion: 0
    };
  }

  return {
    tenantId,
    lifecycleStatus: data.lifecycle_status,
    dataHome: data.data_home,
    desiredDataHome: data.desired_data_home,
    migrationStatus: data.migration_status,
    routingVersion: Number(data.routing_version ?? 0)
  };
}

export async function resolveTenantDataRoute(
  tenantId: string,
  options?: { fresh?: boolean }
): Promise<TenantDataRoute> {
  if (!options?.fresh) {
    const cached = readCachedTenantDataRoute(tenantId);
    if (cached) return cached;

    const inFlight = getTenantDataRouteInFlight();
    const existing = inFlight.get(tenantId);
    if (existing) return existing;

    const pending: Promise<TenantDataRoute> = loadTenantDataRoute(tenantId)
      .then((resolved) => {
        // A mutation may have invalidated this lookup while it was in flight.
        // Never let an older read overwrite a route refreshed for a write.
        if (inFlight.get(tenantId) === pending) {
          writeCachedTenantDataRoute(tenantId, resolved);
        }
        return resolved;
      })
      .finally(() => {
        // Do not clear a newer in-flight request after an invalidation.
        if (inFlight.get(tenantId) === pending) {
          inFlight.delete(tenantId);
        }
      });
    inFlight.set(tenantId, pending);
    return pending;
  }

  // Invalidate the previous read cache and its in-flight resolution before a
  // mutation decides the authoritative data home (Primary versus Trial).
  invalidateTenantDataRouteCache(tenantId);
  const resolved = await loadTenantDataRoute(tenantId);
  writeCachedTenantDataRoute(tenantId, resolved);
  return resolved;
}

export async function getTenantDataServiceClient(
  tenantId: string,
  options?: { mutation?: boolean }
) {
  // Only explicitly read-only callers may cache routing. Legacy callers
  // without a mutation flag still resolve fresh to avoid stale data-plane writes.
  // Mutations also invalidate any prior cache/in-flight read resolution.
  const route = await resolveTenantDataRoute(tenantId, { fresh: options?.mutation !== false });

  if (route.dataHome === "primary") {
    return { client: getSupabaseServiceClient(), route };
  }

  if (route.dataHome === "trial") {
    if (!isTrialDataRoutingConfigured()) {
      // Never silently write a trial tenant back to Primary when the Trial DB is
      // unavailable. That would create split-brain data during an outage.
      throw new Error("trial_data_route_unavailable");
    }
    return { client: getTrialServiceClient(), route };
  }

  if (options?.mutation) {
    throw new Error("archived_tenant_is_read_only");
  }

  throw new Error("archive_data_route_not_configured");
}