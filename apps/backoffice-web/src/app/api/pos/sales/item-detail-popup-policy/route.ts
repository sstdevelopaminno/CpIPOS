import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { PosGuardError } from "@/lib/pos-session-guard";
import { loadPosItemDetailPopupEnabledForScope } from "@/lib/services/table-qr-automation-policy-service";

// Cashiers may read only the popup flag for their authenticated branch.
export async function GET() {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:enter" });
    const tenantId = String(auth.tenantId ?? "");
    const branchId = String(auth.branchId ?? "");
    const item_detail_popup_enabled = await loadPosItemDetailPopupEnabledForScope({ tenantId, branchId });
    return ok({ branch_id: branchId, item_detail_popup_enabled });
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    return fail("item_detail_popup_policy_failed", "Unable to load item-detail popup setting.", 500);
  }
}
