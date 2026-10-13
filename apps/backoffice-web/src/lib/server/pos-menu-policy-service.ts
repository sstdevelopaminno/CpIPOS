import "server-only";
import { notFound } from "next/navigation";
import { isCustomPosMenuVisible, posMenuKeyForRoute } from "@/lib/pos-menu-policy";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

/** Read the authoritative tenant policy; absent rows preserve existing POS menus. */
export async function getTenantPosMenuOverrides(tenantId: string): Promise<Record<string, boolean>> {
  const { data, error } = await getSupabaseServiceClient()
    .from("tenant_pos_menu_policies").select("menu_key,is_enabled")
    .eq("tenant_id", tenantId);
  if (error) throw new Error("pos_menu_policy_lookup_failed:" + error.message);
  const overrides = Object.fromEntries((data ?? []).map(row => [row.menu_key, row.is_enabled])) as Record<string, boolean>;
  // One-release compatibility while CpIPOS and CpIPOS-IT move the AI/payment
  // controls to their new canonical locations. New keys always win.
  if (overrides["main.ai_assistant"] === undefined && overrides["more.ai_assistant"] !== undefined) {
    overrides["main.ai_assistant"] = overrides["more.ai_assistant"];
  }
  if (overrides["main.package_payment"] === undefined && overrides["main.payments"] !== undefined) {
    overrides["main.package_payment"] = overrides["main.payments"];
  }
  if (overrides["settings.support"] === undefined && overrides["main.payments"] !== undefined) {
    overrides["settings.support"] = overrides["main.payments"];
  }
  return overrides;
}

/** Return the tenant-scoped switch for one menu key. Absence remains enabled. */
export async function isTenantPosMenuEnabled(tenantId: string, menuKey: string): Promise<boolean> {
  const overrides = await getTenantPosMenuOverrides(tenantId);
  return overrides[menuKey] !== false;
}

/**
 * Fixed plans preserve legacy navigation locks; CUSTOM pages are server-gated
 * against the same explicit IT allowlist used by the navigation and CRM.
 * Never authorize a CUSTOM page based on browser-side visibility alone.
 */
/** Shared server-side CUSTOM discriminator for POS page authorization. */
export async function isTenantCustomPosPackage(tenantId: string): Promise<boolean> {
  const supabase = getSupabaseServiceClient();
  const { data: contract, error: contractError } = await supabase
    .from("tenant_subscription_contracts")
    .select("package_id")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ package_id: string | null }>();
  if (contractError) throw new Error("custom_menu_contract_lookup_failed:" + contractError.message);
  if (!contract?.package_id) return false;
  const { data: pkg, error: packageError } = await supabase
    .from("subscription_packages")
    .select("code").eq("id", contract.package_id)
    .maybeSingle<{ code: string }>();
  if (packageError) throw new Error("custom_menu_package_lookup_failed:" + packageError.message);
  return String(pkg?.code ?? "").toLowerCase() === "custom";
}

export async function assertPosMenuPageAllowed(tenantId: string, path: string): Promise<void> {
  const menuKey = posMenuKeyForRoute(path);
  if (!menuKey) return;
  if (!await isTenantCustomPosPackage(tenantId)) return;
  const overrides = await getTenantPosMenuOverrides(tenantId);
  if (!isCustomPosMenuVisible(menuKey, overrides, true)) notFound();
}
