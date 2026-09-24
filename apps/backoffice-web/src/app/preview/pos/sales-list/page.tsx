import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosSession } from "@/lib/pos-session-guard";
import type { BranchRole } from "@pos/shared-types";
import { PosSalesListWorkspace } from "@/components/pos-preview/pos-sales-list-workspace";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { loadPosSalesListData } from "@/lib/services/pos-sales-list-service";

export default async function PosSalesListPage() {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/sales-list");
  const scope = await requirePosPagePermission("sales:list:view");
  const lang = await getCurrentLanguage();
  const branchRole = scope.session.role as BranchRole;

  const initialData = await loadPosSalesListData({
    userId: scope.session.user_id,
    tenantId: scope.session.tenant_id,
    branchId: scope.session.branch_id,
    branchRole,
    platformRole: "tenant_user"
  });

  return (
    <PosSalesListWorkspace
      lang={lang}
      initialRole={branchRole}
      platformRole="tenant_user"
      initialBranchId={scope.session.branch_id}
      initialRecords={initialData.records}
      branchOptions={initialData.branchOptions}
      shiftOptions={initialData.shiftOptions}
      refreshEndpoint="/api/pos/sales-list"
    />
  );
}
