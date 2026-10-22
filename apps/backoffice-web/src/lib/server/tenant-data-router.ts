import "server-only";

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

// CpiPOS-002 has been retired. Keep the legacy discriminator to refuse stale
// rows safely; no second Supabase client may be created.
export function isTrialDataRoutingConfigured() {
  return false;
}

export async function resolveTenantDataRoute(tenantId: string): Promise<TenantDataRoute> {
  const primary = getSupabaseServiceClient();
  const { data, error } = await primary
    .from("tenant_data_lifecycle")
    .select("tenant_id,lifecycle_status,data_home,desired_data_home,migration_status,routing_version")
    .eq("tenant_id", tenantId)
    .maybeSingle<LifecycleRow>();

  if (error) {
    throw new Error(`tenant_data_route_lookup_failed:${error.message}`);
  }

  // Compatibility-safe default for tenants created before the lifecycle control
  // plane. New onboarding must always create an explicit lifecycle row.
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

export async function getTenantDataServiceClient(
  tenantId: string,
  options?: { mutation?: boolean }
) {
  const route = await resolveTenantDataRoute(tenantId);

  if (route.dataHome === "primary") {
    return { client: getSupabaseServiceClient(), route };
  }

  if (route.dataHome === "trial") {
    // Never silently fall back to Primary for a stale authoritative data_home.
    throw new Error("trial_data_route_unavailable");
  }

  if (options?.mutation) {
    throw new Error("archived_tenant_is_read_only");
  }

  throw new Error("archive_data_route_not_configured");
}
