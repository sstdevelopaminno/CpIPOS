import { isFeatureUnlockEnabled } from "@/lib/feature-unlock";
import { fail, ok } from "@/lib/http";
import { allPosMenuFeatureCodes } from "@/lib/pos-feature-map";
import { requirePosSession, PosGuardError } from "@/lib/pos-session-guard";
import { normalizePosSalesModes } from "@/lib/pos-sales-modes";
import { readThroughRuntimeCache } from "@/lib/route-runtime-cache";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { getTenantPosMenuOverrides } from "@/lib/server/pos-menu-policy-service";

type ContractRow = {
  package_id: string | null;
  status: string | null;
  ended_at: string | null;
  metadata: Record<string, unknown> | null;
};

type PackageFeatureRow = {
  feature_code: string;
  included: boolean | null;
};

type FeatureOverrideRow = {
  feature_code: string;
  branch_id: string | null;
  is_enabled: boolean | null;
};

function contractAllowsAccess(contract: ContractRow | null) {
  if (!contract) return false;
  if (contract.status !== "active" && contract.status !== "trial") return false;
  if (!contract.ended_at) return true;

  const endMs = new Date(contract.ended_at).getTime();
  return !Number.isFinite(endMs) || endMs > Date.now();
}

async function loadTenantFeatureSnapshot(tenantId: string, branchId: string) {
  const supabase = getSupabaseServiceClient();
  const { data: contract, error: contractError } = await supabase
    .from("tenant_subscription_contracts")
    .select("package_id,status,ended_at,metadata")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<ContractRow>();

  if (contractError) {
    throw new Error(`feature_contract_query_failed:${contractError.message}`);
  }

  const metadata = contract?.metadata && typeof contract.metadata === "object" ? contract.metadata : {};
  const salesModes = normalizePosSalesModes(metadata.sales_modes);
  const featureCodes = allPosMenuFeatureCodes();

  if (isFeatureUnlockEnabled()) {
    return {
      features: Object.fromEntries(featureCodes.map((feature) => [feature, true])),
      salesModes
    };
  }

  if (!featureCodes.length || !contractAllowsAccess(contract ?? null) || !contract?.package_id) {
    return {
      features: Object.fromEntries(featureCodes.map((feature) => [feature, false])),
      salesModes
    };
  }

  // IMPORTANT: load the package feature matrix and all tenant/branch overrides in
  // bulk. The previous implementation called hasBranchFeatureSafe() once per menu
  // item, which produced three Supabase REST reads for every feature. In a
  // serverless runtime that multiplied a single /api/pos/features request into
  // dozens of edge/postgrest log events and was the largest source of Log
  // Ingestion usage.
  const [packageResult, overrideResult] = await Promise.all([
    supabase
      .from("subscription_package_features")
      .select("feature_code,included")
      .eq("package_id", contract.package_id)
      .in("feature_code", featureCodes),
    supabase
      .from("tenant_feature_subscriptions")
      .select("feature_code,branch_id,is_enabled")
      .eq("tenant_id", tenantId)
      .in("feature_code", featureCodes)
      .or(`branch_id.is.null,branch_id.eq.${branchId}`)
  ]);

  if (packageResult.error) {
    throw new Error(`plan_feature_query_failed:${packageResult.error.message}`);
  }
  if (overrideResult.error) {
    throw new Error(`feature_override_query_failed:${overrideResult.error.message}`);
  }

  const packageFeatures = new Map<string, boolean>();
  for (const row of (packageResult.data ?? []) as PackageFeatureRow[]) {
    packageFeatures.set(String(row.feature_code), Boolean(row.included));
  }

  const tenantOverrides = new Map<string, boolean>();
  const branchOverrides = new Map<string, boolean>();
  for (const row of (overrideResult.data ?? []) as FeatureOverrideRow[]) {
    const featureCode = String(row.feature_code ?? "").trim();
    if (!featureCode) continue;
    if (row.branch_id) {
      branchOverrides.set(featureCode, Boolean(row.is_enabled));
    } else {
      tenantOverrides.set(featureCode, Boolean(row.is_enabled));
    }
  }

  const features = Object.fromEntries(
    featureCodes.map((feature) => {
      let enabled = packageFeatures.get(feature) ?? false;
      if (tenantOverrides.has(feature)) enabled = tenantOverrides.get(feature) ?? false;
      if (branchOverrides.has(feature)) enabled = branchOverrides.get(feature) ?? false;
      return [feature, enabled];
    })
  );

  return { features, salesModes };
}

export async function GET() {
  try {
    const scope = await requirePosSession();
    const bundle = await readThroughRuntimeCache({
      key: `pos-feature-bundle:${scope.session.tenant_id}:${scope.session.branch_id}`,
      ttlMs: 60_000,
      staleIfErrorMs: 5 * 60_000,
      loaderTimeoutMs: 4_000,
      timeoutCode: "pos_feature_bundle_timeout",
      loader: async () => {
        const [snapshot, menuPolicy] = await Promise.all([
          loadTenantFeatureSnapshot(scope.session.tenant_id, scope.session.branch_id),
          getTenantPosMenuOverrides(scope.session.tenant_id)
        ]);
        return { snapshot, menuPolicy };
      }
    });
    const { snapshot, menuPolicy } = bundle.value;

    const response = ok({
      tenant_id: scope.session.tenant_id,
      branch_id: scope.session.branch_id,
      features: snapshot.features,
      menu_policy: menuPolicy,
      sales_modes: snapshot.salesModes,
      sales_modes_source: "tenant_subscription_contracts.metadata.sales_modes"
    });

    // Feature entitlements change infrequently. A short private browser cache cuts
    // duplicate startup/navigation reads without allowing shared/CDN caching or
    // delaying IT entitlement changes for more than a few seconds.
    response.headers.set("Cache-Control", "private, max-age=60, stale-while-revalidate=60");
    return response;
  } catch (error) {
    if (error instanceof PosGuardError) {
      return fail(error.code, error.message, error.status);
    }
    return fail("pos_features_failed", error instanceof Error ? error.message : "Unable to load POS features.", 500);
  }
}
