import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { isFinancePackageAllowed } from "@/lib/finance-package-policy";
import type { PaidGraceFeatureRuntime } from "@/lib/paid-grace-feature-access";

type FinanceContractRow = {
  package_id: string | null;
  status: string | null;
  ended_at: string | null;
};

/**
 * The server owns the package decision. Never trust the role, package, or
 * tenant ID supplied by a browser. No new DB feature row or migration.
 */
export async function hasFinancePackageAccess(tenantId: string): Promise<boolean> {
  if (!tenantId) return false;
  const db = getSupabaseServiceClient();
  const contract = await db.from("tenant_subscription_contracts")
    .select("package_id,status,ended_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<FinanceContractRow>();
  if (contract.error) throw new Error("finance_contract_unavailable");
  if (!contract.data?.package_id) return false;

  const [pkg, runtime] = await Promise.all([
    db.from("subscription_packages")
      .select("code").eq("id", contract.data.package_id)
      .maybeSingle<{ code: string }>(),
    db.from("tenant_subscription_runtime")
      .select("lifecycle_status,access_locked,lock_reason,expires_at")
      .eq("tenant_id", tenantId)
      .maybeSingle<PaidGraceFeatureRuntime>()
  ]);
  // Finance is sensitive: refuse to proceed when subscription authority cannot be checked.
  if (pkg.error || runtime.error) throw new Error("finance_subscription_unavailable");
  return isFinancePackageAllowed({
    packageCode: pkg.data?.code,
    contractStatus: contract.data.status,
    endedAt: contract.data.ended_at,
    runtime: runtime.data ?? null
  });
}
