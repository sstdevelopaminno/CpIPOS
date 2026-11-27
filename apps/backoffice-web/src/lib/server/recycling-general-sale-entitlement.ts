import "server-only";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { hasBranchFeature } from "@/lib/feature-gate";

/**
 * The optional ordinary/grocery cashier is a separate IT-selected mode,
 * never a prerequisite for Recycling. A CUSTOM trial must be active, and
 * a stale (older) contract must not re-enable an ungranted mode.
 */
export async function isAuthorizedCustomGeneralSaleTenant(tenantId: string, branchId: string): Promise<boolean> {
  if (!tenantId || !branchId) return false;
  const db = getSupabaseServiceClient();
  const { data: contract, error } = await db.from("tenant_subscription_contracts")
    .select("package_id,status,ended_at,metadata")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  if (error || !contract || !["active", "trial"].includes(contract.status)) return false;
  if (contract.ended_at && (!Number.isFinite(Date.parse(contract.ended_at)) ||
      Date.parse(contract.ended_at) <= Date.now())) return false;
  const metadata = contract.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const raw = (metadata as Record<string,unknown>).sales_modes;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      (raw as Record<string,unknown>).general_sale !== true) return false;

  const [pkg,lifecycle,tenant] = await Promise.all([
    db.from("subscription_packages").select("code").eq("id",contract.package_id).maybeSingle(),
    db.from("tenant_data_lifecycle")
      .select("access_locked,lifecycle_status,trial_expires_at,subscription_expires_at")
      .eq("tenant_id",tenantId).maybeSingle(),
    db.from("tenants").select("is_active").eq("id",tenantId).maybeSingle()
  ]);
  if (pkg.error || lifecycle.error || tenant.error ||
      pkg.data?.code !== "custom" || tenant.data?.is_active !== true ||
      !lifecycle.data || lifecycle.data.access_locked === true) return false;
  if (lifecycle.data.lifecycle_status === "trial") {
    if (!lifecycle.data.trial_expires_at ||
        (!Number.isFinite(Date.parse(lifecycle.data.trial_expires_at)) || Date.parse(lifecycle.data.trial_expires_at) <= Date.now())) return false;
  } else if (lifecycle.data.lifecycle_status === "active") {
    if (lifecycle.data.subscription_expires_at &&
        (!Number.isFinite(Date.parse(lifecycle.data.subscription_expires_at)) || Date.parse(lifecycle.data.subscription_expires_at) <= Date.now())) return false;
  } else return false;
  // The selected CUSTOM mode grants only what the central branch-scoped
  // policy permits. A missing tenant override is not an explicit denial.
  // Both checks are required, including the scanner feature's explicit denials.
  const [cashier, scanner] = await Promise.all([
    hasBranchFeature(tenantId, branchId, "core_pos_sales"),
    hasBranchFeature(tenantId, branchId, "barcode_scanner_mode")
  ]);
  return cashier && scanner;
}
