import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { fail, ok } from "@/lib/http";
import { resolveProductProfile } from "@/lib/product-profile-policy";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true });
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("tenants")
      .select("code,metadata")
      .eq("id", auth.tenantId!)
      .maybeSingle<{ code: string | null; metadata: Record<string, unknown> | null }>();
    if (error) return fail("product_profile_query_failed", error.message, 500);
    const tenantCode = String(data?.code ?? "").trim().toUpperCase();
    const productProfile = resolveProductProfile({ tenantCode, tenantMetadata: data?.metadata ?? null });
    return ok({ tenant_code: tenantCode, product_profile: productProfile });
  } catch (error) {
    return fail("unauthorized", error instanceof Error ? error.message : "Authentication failed.", 401);
  }
}
