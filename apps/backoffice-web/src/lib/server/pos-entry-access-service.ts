import "server-only";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {isFeatureUnlockEnabled} from "@/lib/feature-unlock";
import {hasBranchFeatureSafe} from "@/lib/server/feature-gate-safe";
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

  if(lookupFailed)throw new PosFeatureLookupUnavailable();
  return false;
}


export async function evaluatePosEntryAccess(supabase:SupabaseServiceClient,tenantId:string,branchId:string) {
  // Check lifecycle first. An expired trial must never be mislabeled as
  // an unavailable sales feature or bypassed via stale feature grants.
  const subscription=await loadPosSubscriptionEntryState(supabase,tenantId);
  const lifecycleDenial=classifyPosEntryDenial(subscription.contract,subscription.lifecycle);
  if(lifecycleDenial)return {allowed:false as const,denial:lifecycleDenial};
  const enabled=await hasAnyPosSalesFeature(supabase,tenantId,branchId);
  if(!enabled)return {allowed:false as const,denial:unavailablePosFeatureDenial()};
  return {allowed:true as const,denial:null};
}
