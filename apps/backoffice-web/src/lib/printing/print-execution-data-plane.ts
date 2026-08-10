import "server-only";

import { getPrimarySupabaseServiceClient, getTrialSupabaseServiceClient } from "@/lib/supabase-admin";

type PrintDataHome = "primary" | "trial" | "archive";

function trialRoutingEnabled() {
  const value = String(process.env.TRIAL_DATA_ROUTING_ENABLED ?? "false").trim().toLowerCase();
  return value === "true" || value === "1";
}

export async function getPrintExecutionDataPlaneClient(tenantId: string) {
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) throw new Error("print_tenant_required");

  const primary = getPrimarySupabaseServiceClient();
  const { data, error } = await primary
    .from("tenant_data_lifecycle")
    .select("data_home")
    .eq("tenant_id", normalizedTenantId)
    .maybeSingle();
  if (error) throw new Error(`print_data_home_lookup_failed:${error.message}`);

  const home = String(data?.data_home ?? "primary").trim().toLowerCase() as PrintDataHome;
  if (home === "primary") return { client: primary, home } as const;
  if (home === "archive") throw new Error("tenant_data_archived");
  if (home !== "trial") throw new Error("tenant_data_home_invalid");
  if (!trialRoutingEnabled()) throw new Error("trial_data_routing_disabled");

  return { client: getTrialSupabaseServiceClient(), home } as const;
}
