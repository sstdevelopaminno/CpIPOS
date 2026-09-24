import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { isPosMenuEnabled, posMenuKeyForRoute } from "@/lib/pos-menu-policy";
import { notFound } from "next/navigation";

/** Read the authoritative tenant policy; absent rows preserve existing POS menus. */
export async function getTenantPosMenuOverrides(tenantId: string): Promise<Record<string, boolean>> {
  const { data, error } = await getSupabaseServiceClient()
    .from("tenant_pos_menu_policies").select("menu_key,is_enabled")
    .eq("tenant_id", tenantId);
  if (error) throw new Error("pos_menu_policy_lookup_failed:" + error.message);
  return Object.fromEntries((data ?? []).map(row => [row.menu_key, row.is_enabled]));
}

/** Guard direct navigation independently of any hidden sidebar/menu link. */
export async function assertPosMenuPageAllowed(tenantId: string, path: string) {
  const key = posMenuKeyForRoute(path);
  if (!key) return;
  const overrides = await getTenantPosMenuOverrides(tenantId);
  if (!isPosMenuEnabled(key, overrides)) notFound();
}
