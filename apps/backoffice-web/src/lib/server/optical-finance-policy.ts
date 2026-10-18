import { getSupabaseServiceClient } from "@/lib/supabase-admin";

/**
 * Independent per-store IT API kill switches configured in the IT Admin tenant
 * card. Missing rows preserve existing CUSTOM grants; explicit OFF denies.
 * Never substitutes for server feature, role, contract, branch or shift checks.
 */
export const OPTICAL_IT_API_CONTROLS = {
  optical_work_orders: "settings.crm_optical_api_work_orders",
  optical_deposit: "settings.crm_optical_api_deposits",
  optical_inventory: "settings.crm_optical_api_inventory",
  optical_customers: "settings.crm_optical_api_customers",
  optical_payment_verification: "settings.crm_optical_api_payment_verification"
} as const;
type OpticalItControl = typeof OPTICAL_IT_API_CONTROLS[keyof typeof OPTICAL_IT_API_CONTROLS];

export async function isOpticalItApiControlAllowed(tenantId: string, control: OpticalItControl): Promise<boolean> {
  const {data,error}=await getSupabaseServiceClient().from("tenant_pos_menu_policies")
    .select("is_enabled").eq("tenant_id",tenantId).eq("menu_key",control)
    .maybeSingle<{is_enabled:boolean}>();
  // On a database failure don't accidentally reopen sensitive finance endpoints.
  return !error && data?.is_enabled !== false;
}

/**
 * All financial Optical routes fail closed unless IT approves both the
 * tenant's CUSTOM Optical entitlement and the requested feature, and a
 * dedicated deployment-level rollout switch is explicitly enabled.
 * This is in addition to POS session / permission / shift checks.
 */
export async function requireOpticalFinanceModule(
  tenantId: string,
  feature: "optical_work_orders" | "optical_deposit" | "optical_inventory"
): Promise<boolean> {
  if (process.env.OPTICAL_FINANCE_V1_ENABLED !== "true") return false;
  const admin = getSupabaseServiceClient();
  const { data: contracts, error } = await admin.from("tenant_subscription_contracts")
    .select("package_id,metadata,status,ended_at")
    .eq("tenant_id", tenantId)
    .in("status", ["active", "trial"])
    .order("created_at", { ascending: false })
    .limit(3);
  if (error || !contracts || contracts.length !== 1) return false;
  const [contract] = contracts;
  if (contract.ended_at && Date.parse(contract.ended_at) <= Date.now()) return false;
  const { data: pkg, error: packageError } = await admin.from("subscription_packages")
    .select("code").eq("id", contract.package_id).maybeSingle();
  if (packageError || String(pkg?.code ?? "").toLowerCase() !== "custom") return false;
  const metadata = contract.metadata as Record<string, unknown> | null;
  const salesModes = metadata?.sales_modes as Record<string, unknown> | undefined;
  const customFeatures = metadata?.custom_features as Record<string, unknown> | undefined;
  if(salesModes?.optical_retail !== true || customFeatures?.[feature] !== true) return false;
  return isOpticalItApiControlAllowed(tenantId,OPTICAL_IT_API_CONTROLS[feature]);
}
