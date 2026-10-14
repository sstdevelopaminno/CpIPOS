import { getSupabaseServiceClient } from "@/lib/supabase-admin";

/** Optical is enabled for a specific IT-authorized CUSTOM tenant, not all CUSTOMs. */
export async function requireOpticalRetailEntitlement(tenantId: string) {
  const admin = getSupabaseServiceClient();
  const { data: contract, error } = await admin.from("tenant_subscription_contracts")
    .select("id,package_id,status,ended_at,metadata")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("optical_contract_query_failed");
  const metadata = contract?.metadata as Record<string, unknown> | null;
  const grants = metadata?.sales_modes && typeof metadata.sales_modes === "object"
    ? metadata.sales_modes as Record<string, unknown> : {};
  const contractValid = (contract?.status === "active" || contract?.status === "trial")
    && (!contract.ended_at || Date.parse(contract.ended_at) > Date.now());
  if (!contractValid || grants.optical_retail !== true || !contract?.package_id) {
    return false;
  }
  const { data: plan, error: planError } = await admin.from("subscription_packages")
    .select("code").eq("id", contract.package_id).maybeSingle();
  if (planError) throw new Error("optical_package_query_failed");
  return String(plan?.code ?? "").toLowerCase() === "custom";
}
