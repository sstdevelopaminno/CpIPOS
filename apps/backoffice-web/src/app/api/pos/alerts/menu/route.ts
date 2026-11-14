import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { loadPosOperationalMenuCounts } from "@/lib/services/pos-menu-operational-alert-service";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["owner", "manager", "staff", "kitchen"]);

/** One lightweight read for the sales and kitchen navigation badges. */
export async function GET() {
  try {
    const scope = await requirePosSession();
    const role = String(scope.session.role ?? "").toLowerCase();
    if (!ALLOWED_ROLES.has(role)) return fail("forbidden", "POS staff access required.", 403);
    if (role !== "kitchen") requirePermission(scope, "sales:view");
    const counts = await loadPosOperationalMenuCounts({
      tenantId: scope.session.tenant_id,
      branchId: scope.session.branch_id,
      includeSales: role !== "kitchen"
    });
    const response = ok(counts);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    console.error("[pos-menu-alerts] failed to load operational badge counts", error);
    return fail("pos_menu_alerts_unavailable", "Unable to load current POS alerts.", 503);
  }
}

