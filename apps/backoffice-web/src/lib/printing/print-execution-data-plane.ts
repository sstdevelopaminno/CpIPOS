import "server-only";

import { BoundedTimeoutError } from "@/lib/server/bounded-timeout";
import { getPrimarySupabaseServiceClient, getTrialSupabaseServiceClient } from "@/lib/supabase-admin";

type PrintDataHome = "primary" | "trial" | "archive";
type CachedDataHome = { home: PrintDataHome; expiresAt: number };

const DATA_HOME_CACHE_MS = 45_000;
const dataHomeCache = new Map<string, CachedDataHome>();

function trialRoutingEnabled() {
  const value = String(process.env.TRIAL_DATA_ROUTING_ENABLED ?? "false").trim().toLowerCase();
  return value === "true" || value === "1";
}

async function resolveDataHome(tenantId: string, signal?: AbortSignal): Promise<PrintDataHome> {
  const now = Date.now();
  const cached = dataHomeCache.get(tenantId);
  if (cached && cached.expiresAt > now) return cached.home;

  const primary = getPrimarySupabaseServiceClient();
  const query = primary
    .from("tenant_data_lifecycle")
    .select("data_home")
    .eq("tenant_id", tenantId);
  const executable = signal ? query.abortSignal(signal) : query;
  const { data, error } = await executable.maybeSingle();
  if (error) {
    if (signal?.aborted) throw new BoundedTimeoutError("print_data_home_lookup_timeout", 0);
    throw new Error(`print_data_home_lookup_failed:${error.message}`);
  }

  const home = String(data?.data_home ?? "primary").trim().toLowerCase() as PrintDataHome;
  if (home !== "primary" && home !== "trial" && home !== "archive") {
    throw new Error("tenant_data_home_invalid");
  }
  dataHomeCache.set(tenantId, { home, expiresAt: now + DATA_HOME_CACHE_MS });
  return home;
}

export async function getPrintExecutionDataPlaneClient(tenantId: string, options: { signal?: AbortSignal } = {}) {
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) throw new Error("print_tenant_required");

  const home = await resolveDataHome(normalizedTenantId, options.signal);
  if (home === "primary") return { client: getPrimarySupabaseServiceClient(), home } as const;
  if (home === "archive") throw new Error("tenant_data_archived");
  if (!trialRoutingEnabled()) throw new Error("trial_data_routing_disabled");

  return { client: getTrialSupabaseServiceClient(), home } as const;
}
