import { fail, ok } from "@/lib/http";
import { FeatureGateError } from "@/lib/feature-gate";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Server-checked, independent accountant authorisation. Never post GL from the
 * cashier sale endpoint, and never use a client-supplied user/tenant/branch.
 * This write is closed until full staging UAT and account mapping sign-off.
 */
export async function POST(request: Request) {
  try {
    const scope = await requirePosSession();
    if (scope.session.role !== "accountant") {
      return fail("accountant_only", "Only a verified branch accountant may post Finance GL.", 403);
    }
    if (!await isAuthorizedRecyclingTenant(scope.session.tenant_id)) {
      return fail("recycling_not_authorized", "Recycling entitlement is not active.", 403);
    }
    if (process.env.RECYCLING_FINANCE_GL_POSTING_ENABLED !== "1") {
      return fail("recycling_finance_uat_only",
        "Finance GL posting is disabled until accounting UAT and independent review are complete.", 503);
    }
    const payload = await request.json().catch(() => null) as Record<string,unknown> | null;
    const id = typeof payload?.transaction_id === "string" ? payload.transaction_id : "";
    if (!UUID.test(id)) {
      return fail("invalid_transaction_id", "A valid transaction ID is required.", 422);
    }
    const db = getSupabaseServiceClient();
    // Staging RPC executes an atomic, second-person approval and Finance posting;
    // purchase Inventory/Payables and sale Revenue+COGS are not routed through
    // the generic supplier_bill expense-only posting function.
    const { data, error } = await db.rpc("recycling_finance_post_transaction", {
      p_tenant_id: scope.session.tenant_id,
      p_branch_id: scope.session.branch_id,
      p_transaction_id: id,
      p_accountant_user_id: scope.session.user_id
    });
    if (error) {
      if (error.code === "PGRST202" || error.code === "42883") {
        return fail("recycling_finance_migration_required",
          "The approved Recycling GL bridge has not been installed.", 503);
      }
      const permitted = ["recycling_finance_self_approval_forbidden",
        "recycling_finance_period_locked","recycling_finance_chart_account_missing_or_invalid",
        "recycling_finance_unbalanced_subledger","recycling_finance_line_total_mismatch",
        "recycling_finance_transaction_not_found"];
      const code = permitted.find(candidate => error.message.includes(candidate));
      if (code) return fail(code, code, 409);
      console.error("[recycling-finance] post failed", { code: error.code });
      return fail("recycling_finance_post_failed", "Unable to post this financial transaction.", 500);
    }
    return ok({ posting: data });
  } catch (error) {
    if (error instanceof PosGuardError || error instanceof FeatureGateError) {
      return fail(error.code, error.message, error.status);
    }
    return fail("recycling_finance_post_failed", "Finance posting did not complete.", 500);
  }
}
