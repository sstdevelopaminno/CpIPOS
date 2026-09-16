import { fail, ok } from "@/lib/http";
import { requirePosSession, PosGuardError } from "@/lib/pos-session-guard";
import {
  resolvePosSubscriptionAccess,
  type PosSubscriptionContractSnapshot,
  type PosTenantLifecycleSnapshot
} from "@/lib/pos-subscription-access";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type TenantBrandRow = {
  display_name: string | null;
  name: string | null;
  logo_url: string | null;
};

function safeLogoUrl(value: string | null | undefined): string | null {
  const logo = String(value ?? "").trim();
  if (!logo) return null;
  if (logo.startsWith("/")) return logo.slice(0, 2000);
  if (/^https:\/\//i.test(logo)) return logo.slice(0, 2000);
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(logo)) return logo.slice(0, 1_500_000);
  return null;
}

export async function GET() {
  try {
    const scope = await requirePosSession();
    const tenantId = scope.session.tenant_id;
    const supabase = getSupabaseServiceClient();

    const [contractResult, lifecycleResult, tenantResult] = await Promise.all([
      supabase
        .from("tenant_subscription_contracts")
        .select("status,started_at,ended_at,metadata")
        .eq("tenant_id", tenantId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle<PosSubscriptionContractSnapshot>(),
      supabase
        .from("tenant_data_lifecycle")
        .select("lifecycle_status,access_locked,lock_reason,metadata")
        .eq("tenant_id", tenantId)
        .maybeSingle<PosTenantLifecycleSnapshot>(),
      supabase
        .from("tenants")
        .select("display_name,name,logo_url")
        .eq("id", tenantId)
        .maybeSingle<TenantBrandRow>()
    ]);

    if (contractResult.error) {
      throw new Error(`subscription_access_contract_query_failed:${contractResult.error.message}`);
    }
    if (lifecycleResult.error) {
      throw new Error(`subscription_access_lifecycle_query_failed:${lifecycleResult.error.message}`);
    }
    if (tenantResult.error) {
      throw new Error(`subscription_access_tenant_query_failed:${tenantResult.error.message}`);
    }

    const access = resolvePosSubscriptionAccess(contractResult.data ?? null, lifecycleResult.data ?? null);
    const tenant = tenantResult.data;

    const response = ok({
      tenant_id: tenantId,
      branch_id: scope.session.branch_id,
      store_name: tenant?.display_name?.trim() || tenant?.name?.trim() || scope.tenant?.name || null,
      logo_url: safeLogoUrl(tenant?.logo_url),
      ...access,
      source: "tenant_subscription_contracts+tenant_data_lifecycle"
    });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  } catch (error) {
    if (error instanceof PosGuardError) {
      return fail(error.code, error.message, error.status);
    }
    console.error("[pos-access-state] failed", error);
    return fail(
      "pos_access_state_failed",
      error instanceof Error ? error.message : "Unable to load POS subscription access state.",
      500
    );
  }
}
