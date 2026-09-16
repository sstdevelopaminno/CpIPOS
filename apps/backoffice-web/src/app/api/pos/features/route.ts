import { isFeatureUnlockEnabled } from "@/lib/feature-unlock";
import { fail, ok } from "@/lib/http";
import { allPosMenuFeatureCodes } from "@/lib/pos-feature-map";
import { requirePosSession, PosGuardError } from "@/lib/pos-session-guard";
import { normalizePosSalesModes } from "@/lib/pos-sales-modes";
import { hasBranchFeatureSafe } from "@/lib/server/feature-gate-safe";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

async function loadTenantSalesModes(tenantId: string) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("tenant_subscription_contracts")
    .select("metadata")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ metadata: Record<string, unknown> | null }>();

  if (error) throw new Error(`sales_mode_policy_query_failed:${error.message}`);
  const metadata = data?.metadata && typeof data.metadata === "object" ? data.metadata : {};
  return normalizePosSalesModes(metadata.sales_modes);
}

export async function GET() {
  try {
    const scope = await requirePosSession();
    const salesModesPromise = loadTenantSalesModes(scope.session.tenant_id);

    if (isFeatureUnlockEnabled()) {
      return ok({
        tenant_id: scope.session.tenant_id,
        branch_id: scope.session.branch_id,
        features: Object.fromEntries(allPosMenuFeatureCodes().map((feature) => [feature, true])),
        sales_modes: await salesModesPromise,
        sales_modes_source: "tenant_subscription_contracts.metadata.sales_modes"
      });
    }

    const [entries, salesModes] = await Promise.all([
      Promise.all(
        allPosMenuFeatureCodes().map(async (feature) => [
          feature,
          await hasBranchFeatureSafe(scope.session.tenant_id, scope.session.branch_id, feature)
        ] as const)
      ),
      salesModesPromise
    ]);

    return ok({
      tenant_id: scope.session.tenant_id,
      branch_id: scope.session.branch_id,
      features: Object.fromEntries(entries),
      sales_modes: salesModes,
      sales_modes_source: "tenant_subscription_contracts.metadata.sales_modes"
    });
  } catch (error) {
    if (error instanceof PosGuardError) {
      return fail(error.code, error.message, error.status);
    }
    return fail("pos_features_failed", error instanceof Error ? error.message : "Unable to load POS features.", 500);
  }
}
