import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { getTenantPosMenuOverrides } from "@/lib/server/pos-menu-policy-service";
import { isCustomPosMenuVisible } from "@/lib/pos-menu-policy";

export type PosCurrencyCode = "THB" | "LAK";
export function normalizePosCurrencyCode(value: unknown): PosCurrencyCode {
  return value === "LAK" ? "LAK" : "THB";
}

/** Separate POS tender currency from the subscription contract's billing currency. */
export async function getCustomPosCurrencyContext(tenantId: string) {
  const admin = getSupabaseServiceClient();
  const { data: contract, error } = await admin.from("tenant_subscription_contracts")
    .select("id,package_id,status,ended_at,updated_at,metadata")
    .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("pos_currency_contract_read_failed");
  if (!contract?.package_id) return { enabled: false, currency_code: "THB" as PosCurrencyCode, contract: null };
  const { data: plan, error: planError } = await admin.from("subscription_packages")
    .select("code").eq("id", contract.package_id).maybeSingle();
  if (planError) throw new Error("pos_currency_package_read_failed");
  const valid = (contract.status === "active" || contract.status === "trial")
    && (!contract.ended_at || Date.parse(contract.ended_at) > Date.now());
  const isCustom = valid && String(plan?.code ?? "").toLowerCase() === "custom";
  const policy = isCustom ? await getTenantPosMenuOverrides(tenantId) : {};
  const enabled = isCustom && isCustomPosMenuVisible("settings.currency", policy, true);
  const metadata = contract.metadata && typeof contract.metadata === "object" && !Array.isArray(contract.metadata)
    ? contract.metadata as Record<string, unknown> : {};
  return { enabled, currency_code: normalizePosCurrencyCode(metadata.pos_currency_code), contract };
}
export async function getTenantPosCurrencyCode(tenantId: string): Promise<PosCurrencyCode> {
  return (await getCustomPosCurrencyContext(tenantId)).currency_code;
}
