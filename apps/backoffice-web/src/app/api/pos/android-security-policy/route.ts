import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePosSessionForNonSaleRecovery } from "@/lib/pos-session-guard";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/**
 * Read-only authoritative IT tenant policy. POS clients never receive IT
 * credentials or the ability to change another tenant's security settings.
 * This remains accessible when billing is locked (but not if session expired).
 */
export async function GET() {
  try {
    const scope = await requirePosSessionForNonSaleRecovery();
    const tenantId = scope.session.tenant_id;
    const result = await getPrimarySupabaseServiceClient()
      .from("tenant_android_security_policies")
      .select("enforce_developer_options_off,updated_at")
      .eq("tenant_id", tenantId)
      .maybeSingle<{ enforce_developer_options_off: boolean; updated_at: string }>();
    if (result.error) throw result.error;
    const response = ok({
      tenant_id: tenantId,
      enforce_developer_options_off: result.data?.enforce_developer_options_off === true,
      updated_at: result.data?.updated_at ?? null
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    // Do not return a fabricated disabled policy on a failed read.
    return fail("android_security_policy_unavailable", "Could not verify IT Android security policy.", 503);
  }
}
