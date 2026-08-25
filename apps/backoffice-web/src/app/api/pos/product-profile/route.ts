import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { fail, ok } from "@/lib/http";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export async function GET() {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true });
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("tenants")
      .select("code")
      .eq("id", auth.tenantId!)
      .maybeSingle<{ code: string }>();
    if (error) return fail("product_profile_query_failed", error.message, 500);
    const tenantCode = String(data?.code ?? "").trim().toUpperCase();
    const productProfile = tenantCode.startsWith("FF")
      ? "BUFFET"
      : tenantCode.startsWith("FG")
        ? "RESTAURANT_QR"
        : "STANDARD";
    return ok({ tenant_code: tenantCode, product_profile: productProfile });
  } catch (error) {
    return fail("unauthorized", error instanceof Error ? error.message : "Authentication failed.", 401);
  }
}
