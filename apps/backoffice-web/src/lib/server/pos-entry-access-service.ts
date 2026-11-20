import "server-only";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {isFeatureUnlockEnabled} from "@/lib/feature-unlock";
import {hasBranchFeatureSafe} from "@/lib/server/feature-gate-safe";
import {isCustomCashierModeEnabled} from "@/lib/pos-sales-modes";
import {classifyPosEntryDenial,unavailablePosFeatureDenial,type PosEntryContract,type PosEntryLifecycle} from "@/lib/server/pos-entry-denial-reasons";
type SupabaseServiceClient=ReturnType<typeof getSupabaseServiceClient>;
type BranchFeatureOverrideRow={enabled:boolean|null};
const POS_SALES_FEATURE_KEYS = ["pos.sales.access", "pos_sales", "core_pos_sales"] as const;
export class PosFeatureLookupUnavailable extends Error {
 constructor(){super("pos_sales_feature_lookup_unavailable");}
}
async function loadPosSubscriptionEntryState(supabase:SupabaseServiceClient,tenantId:string){
 const [contract,lifecycle]=await Promise.all([
   supabase.from("tenant_subscription_contracts").select("status,ended_at,package_id")
     .eq("tenant_id",tenantId).order("created_at",{ascending:false}).limit(1).maybeSingle<PosEntryContract>(),
   supabase.from("tenant_data_lifecycle")
     .select("lifecycle_status,access_locked,lock_reason,trial_expires_at,subscription_expires_at,grace_until,metadata")
     .eq("tenant_id",tenantId).maybeSingle<PosEntryLifecycle>()
 ]);
 if(contract.error||lifecycle.error){
   console.error("[auth/devices/select] subscription state unavailable",{
     tenantId,source:contract.error?"contract":"lifecycle"
   });
   throw new PosFeatureLookupUnavailable();
 }
 return {contract:contract.data??null,lifecycle:lifecycle.data??null};
}

function isMissingBranchFeatureOverrideError(error: { code?: string | null; message?: string | null } | null | undefined) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "").toLowerCase();
  return code === "42P01" || message.includes("branch_feature_overrides") || message.includes("does not exist");
}

async function readBranchFeatureOverride(
  supabase: SupabaseServiceClient,
  tenantId: string,
  branchId: string,
  featureKey: string
): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("branch_feature_overrides")
    .select("enabled")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("feature_key", featureKey)
    .maybeSingle<BranchFeatureOverrideRow>();

  if (error) {
    if (isMissingBranchFeatureOverrideError(error)) return null;

    console.error("[auth/devices/select] branch feature override lookup failed", {
      tenantId,
      branchId,
      featureKey,
      error: error.message
    });
    throw new PosFeatureLookupUnavailable();
  }

  if (!data) return null;
  return Boolean(data.enabled);
}

/**
 * The device selector must honour the SAME explicit CUSTOM cashier mode as
 * the protected POS pages. A CUSTOM plan by itself grants nothing. This fresh
 * database check is used only when the ordinary cached feature lookup gives
 * no grant, so an older negative feature cache cannot strand an eligible
 * General Sale tenant at "เปิดแคช".
 *
 * Check both IT feature override sources; any explicit denial takes
 * precedence. Subscription expiration and lock are checked by
 * evaluatePosEntryAccess BEFORE this helper runs.
 */
async function hasFreshItApprovedCustomCashierMode(
 supabase:SupabaseServiceClient,tenantId:string,branchId:string
):Promise<boolean> {
 const contractResult=await supabase.from("tenant_subscription_contracts")
   .select("status,ended_at,package_id,metadata")
   .eq("tenant_id",tenantId).order("created_at",{ascending:false})
   .limit(1).maybeSingle();
 if(contractResult.error)throw new PosFeatureLookupUnavailable();
 const contract=contractResult.data;
 if(!contract || !["active","trial"].includes(contract.status) ||
     (contract.ended_at && (!Number.isFinite(Date.parse(contract.ended_at)) ||
         Date.parse(contract.ended_at)<=Date.now())) ||
     !contract.package_id ||
     !isCustomCashierModeEnabled(
       (contract.metadata && typeof contract.metadata==="object" &&
        !Array.isArray(contract.metadata)
          ? (contract.metadata as Record<string,unknown>).sales_modes : null)
     )) return false;

 const [plan,tenantOverrides,branchOverrides]=await Promise.all([
   supabase.from("subscription_packages").select("code")
     .eq("id",contract.package_id).maybeSingle(),
   supabase.from("tenant_feature_subscriptions")
     .select("branch_id,feature_code,is_enabled")
     .eq("tenant_id",tenantId).in("feature_code",[...POS_SALES_FEATURE_KEYS]),
   supabase.from("branch_feature_overrides")
     .select("feature_key,enabled")
     .eq("tenant_id",tenantId).eq("branch_id",branchId)
     .in("feature_key",[...POS_SALES_FEATURE_KEYS])
 ]);
 if(plan.error || tenantOverrides.error ||
     (branchOverrides.error && !isMissingBranchFeatureOverrideError(branchOverrides.error)))
   throw new PosFeatureLookupUnavailable();
 if(String(plan.data?.code??"").toLowerCase()!=="custom")return false;

 // No fallback over any explicit IT-controlled denial. A disabled tenant
 // grant or a branch-specific denial always requires IT to enable it.
 if((tenantOverrides.data??[]).some(row =>
   (row.branch_id===null || row.branch_id===branchId) && row.is_enabled===false
 ) || (branchOverrides.data??[]).some(row => row.enabled===false))return false;
 return true;
}

async function hasAnyPosSalesFeature(supabase: SupabaseServiceClient, tenantId: string, branchId: string) {
  if (isFeatureUnlockEnabled()) return true;
  for (const featureKey of POS_SALES_FEATURE_KEYS) {
    const directOverrideEnabled = await readBranchFeatureOverride(supabase, tenantId, branchId, featureKey);
    if (directOverrideEnabled === true) return true;
  }

  let lookupFailed=false;
  for (const featureKey of POS_SALES_FEATURE_KEYS) {
    try {
      const enabled = await hasBranchFeatureSafe(tenantId, branchId, featureKey);
      if (enabled) return true;
    } catch (error) {
      lookupFailed=true;
      console.error("[auth/devices/select] POS sales feature lookup failed", {
        tenantId,
        branchId,
        featureKey,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  // A selected CUSTOM General Sale or Optical mode must also unlock the
  // register chooser, just as it unlocks the protected POS cashier route.
  // This check is fresh and preserves all explicit IT denials.
  if(await hasFreshItApprovedCustomCashierMode(supabase,tenantId,branchId))return true;
  if(lookupFailed)throw new PosFeatureLookupUnavailable();
  return false;
}


export async function evaluatePosEntryAccess(supabase:SupabaseServiceClient,tenantId:string,branchId:string) {
  // Check lifecycle first. An expired trial must never be mislabeled as
  // an unavailable sales feature or bypassed via stale feature grants.
  const subscription=await loadPosSubscriptionEntryState(supabase,tenantId);
  const provisional=await supabase.from("tenant_subscription_payment_requests")
    .select("id")
    .eq("tenant_id",tenantId).eq("status","under_review").eq("auto_check_status","passed")
    .not("provisional_access_granted_at","is",null).is("provisional_access_revoked_at",null)
    .order("provisional_access_granted_at",{ascending:false}).limit(1).maybeSingle();
  if(provisional.error)throw new PosFeatureLookupUnavailable();
  const temporary=Boolean(provisional.data?.id && subscription.lifecycle?.access_locked===false &&
    subscription.lifecycle.lock_reason==="subscription_payment_provisional_review" &&
    subscription.lifecycle.metadata?.provisional_payment_request_id===provisional.data.id);
  const lifecycleDenial=classifyPosEntryDenial(subscription.contract,subscription.lifecycle);
  if(lifecycleDenial && !temporary)return {allowed:false as const,denial:lifecycleDenial};
  const enabled=await hasAnyPosSalesFeature(supabase,tenantId,branchId);
  if(!enabled)return {allowed:false as const,denial:unavailablePosFeatureDenial()};
  return {allowed:true as const,denial:null};
}
