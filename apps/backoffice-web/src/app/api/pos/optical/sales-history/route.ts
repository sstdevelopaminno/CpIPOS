import type { BranchRole } from "@pos/shared-types";
import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { isCustomPosMenuVisible } from "@/lib/pos-menu-policy";
import { requireOpticalRetailEntitlement } from "@/lib/server/optical-entitlement";
import { getTenantPosMenuOverrides } from "@/lib/server/pos-menu-policy-service";
import { loadPosSalesListData } from "@/lib/services/pos-sales-list-service";

/** Read-only basic sales history. Never reuses advanced reports' PATCH/DELETE. */
export async function GET() {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "sales:list:view");
    if (!await requireOpticalRetailEntitlement(scope.session.tenant_id)) {
      return fail("optical_mode_denied", "CUSTOM Optical mode is not enabled.", 403);
    }
    const policies = await getTenantPosMenuOverrides(scope.session.tenant_id);
    if (!isCustomPosMenuVisible("main.sales_list", policies, true)) {
      return fail("optical_sales_history_menu_locked", "Sales history menu is disabled by IT.", 403);
    }
    const history = await loadPosSalesListData({
      userId: scope.session.user_id,
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      branchRole: scope.session.role as BranchRole,
      platformRole: "tenant_user"
    });
    const response = ok({ records: history.records, branches: history.branchOptions });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch(error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    return fail("optical_sales_history_unavailable", "Unable to load basic Optical sales history.", 503);
  }
}
