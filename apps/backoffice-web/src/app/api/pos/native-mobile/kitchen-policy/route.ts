import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { PosGuardError } from "@/lib/pos-session-guard";
import { loadTableQrAutomationPolicyForScope } from "@/lib/services/table-qr-automation-policy-service";

export const dynamic = "force-dynamic";

/**
 * Minimal read-only effective kitchen policy for a registered Native cashier.
 *
 * The settings management route requires settings:view, which ordinary staff
 * need not have. This route reveals no overrides, settings or tenant records:
 * it only lets sale:create users decide whether a confirmed dine-in order
 * should be routed to the centrally configured kitchen.
 */
export async function GET() {
  const headers = { "Cache-Control": "private, no-store, max-age=0" };
  try {
    const auth = await getPosApiAuthContext({
      requireBranchScope: true,
      requiredPermission: "sale:create"
    });
    if (!auth.tenantId || !auth.branchId) {
      return fail("missing_branch_scope", "Active branch is required.", 403);
    }
    const policy = await loadTableQrAutomationPolicyForScope({
      tenantId: auth.tenantId,
      branchId: auth.branchId
    });
    const response = ok({
      effective_kitchen_auto_send_enabled: policy.effective.kitchen_auto_send_enabled
    });
    response.headers.set("Cache-Control", headers["Cache-Control"]);
    return response;
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    return fail("native_kitchen_policy_unavailable", "Kitchen policy could not be verified.", 503);
  }
}
