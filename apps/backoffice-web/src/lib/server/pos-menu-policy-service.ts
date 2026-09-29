import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

/** Read the authoritative tenant policy; absent rows preserve existing POS menus. */
export async function getTenantPosMenuOverrides(tenantId: string): Promise<Record<string, boolean>> {
  const { data, error } = await getSupabaseServiceClient()
    .from("tenant_pos_menu_policies").select("menu_key,is_enabled")
    .eq("tenant_id", tenantId);
  if (error) throw new Error("pos_menu_policy_lookup_failed:" + error.message);
  return Object.fromEntries((data ?? []).map(row => [row.menu_key, row.is_enabled]));
}

/** Return the tenant-scoped switch for one menu key. Absence remains enabled. */
export async function isTenantPosMenuEnabled(tenantId: string, menuKey: string): Promise<boolean> {
  const overrides = await getTenantPosMenuOverrides(tenantId);
  return overrides[menuKey] !== false;
}

/**
 * Legacy page call-site kept as a no-op for compatibility.
 * IT menu switches affect only navigation controls. Direct links, internal POS
 * workflows and package/role authorization must not inherit a menu lock.
 */
export async function assertPosMenuPageAllowed(_tenantId: string, _path: string): Promise<void> {
  return;
}
