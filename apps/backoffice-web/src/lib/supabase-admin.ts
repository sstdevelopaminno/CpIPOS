import "server-only";

export {
  getPrimarySupabaseServiceClient,
  getRoutedSupabaseServiceClient as getSupabaseServiceClient,
  getTrialSupabaseServiceClient,
  invalidateTenantDataRouteCache,
  TenantDataRoutingError
} from "@/lib/tenant-data-router";
