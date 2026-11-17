import "server-only";

import { hasFinancePackageAccess } from "@/lib/server/finance-package-access";
import { requireFinanceSession } from "@/lib/server/finance-session";
import { getTenantPosMenuOverrides } from "@/lib/server/pos-menu-policy-service";
import { isAccountantMenuVisible } from "@/lib/accountant-menu-policy";
import { requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type FinanceReportActor = "accountant" | "owner";
export type FinanceReadScope = {
  actor: FinanceReportActor;
  tenantId: string;
  userId: string;
  branchIds: string[]; // always explicit, verified branch grants for the selected actor
};
export class FinanceReportError extends Error {
  constructor(public code: string, public status: number = 403) {
    super(code);
    this.name = "FinanceReportError";
  }
}

/** Purpose-separated authentication. A Finance cookie CANNOT become a POS
 * Owner token. Both actors get server-owned tenant and branch constraints.
 */
export async function requireFinanceReadScope(actor: FinanceReportActor): Promise<FinanceReadScope> {
  if (actor === "accountant") {
    const identity = await requireFinanceSession();
    if (!identity) throw new FinanceReportError("finance_session_required", 401);
    const overrides = await getTenantPosMenuOverrides(identity.tenantId);
    if (!isAccountantMenuVisible("main.finance", overrides))
      throw new FinanceReportError("finance_menu_disabled", 403);
    return {
      actor, tenantId: identity.tenantId,
      userId: identity.userId, branchIds: identity.branchIds
    };
  }

  const posScope = await requirePosSession();
  if (String(posScope.session.role).toLowerCase() !== "owner")
    throw new FinanceReportError("finance_owner_required", 403);
  const tenantId = posScope.session.tenant_id;
  if (!await hasFinancePackageAccess(tenantId))
    throw new FinanceReportError("finance_package_required", 403);
  const overrides = await getTenantPosMenuOverrides(tenantId);
  if (overrides["main.finance"] === false)
    throw new FinanceReportError("finance_menu_disabled", 403);
  // A branch Owner POS login is not proof of ownership in unrelated branches.
  // Only explicitly recorded Owner memberships may be read by this report.
  const grants = await getSupabaseServiceClient().from("user_branch_roles")
    .select("branch_id")
    .eq("tenant_id", tenantId).eq("user_id", posScope.session.user_id)
    .eq("role", "owner");
  if (grants.error) throw new FinanceReportError("finance_owner_branches_unavailable", 503);
  const branchIds = (grants.data ?? []).map(row => String(row.branch_id));
  if (!branchIds.includes(posScope.session.branch_id))
    throw new FinanceReportError("finance_owner_scope_required", 403);
  return {
    actor, tenantId, userId: posScope.session.user_id,
    branchIds
  };
}
