import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { RecyclingSalesListPageContent } from "@/components/pos/recycling-sales-list-page-content";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { isAuthorizedCustomGeneralSaleTenant } from "@/lib/server/recycling-general-sale-entitlement";
import type { RecyclingReportQuery } from "@/lib/server/recycling-history-reports";
import { requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { requireOpticalRetailEntitlement } from "@/lib/server/optical-entitlement";
import { hasBranchFeature } from "@/lib/feature-gate";
import { PosOpticalBasicSalesHistory } from "@/components/pos-preview/pos-optical-basic-sales-history";
import type { BranchRole } from "@pos/shared-types";
import { PosSalesListWorkspace } from "@/components/pos-preview/pos-sales-list-workspace";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { loadPosSalesListData } from "@/lib/services/pos-sales-list-service";

export default async function PosSalesListPage({searchParams}:{searchParams?:Promise<RecyclingReportQuery>}) {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/sales-list");
  // Only CUSTOM Recycling has the buy-in/sell-out inventory and accounting
  // ledger. Preserve the ordinary POS order list for all other packages.
  // Where a Recycling tenant also has the optional general-sale entitlement,
  // its existing standard sales page remains reachable explicitly.
  const options=await searchParams;
  const canUseStandard=options?.report_mode==="standard" &&
    await isAuthorizedCustomGeneralSaleTenant(posMenuScope.session.tenant_id, posMenuScope.session.branch_id);
  if(await isAuthorizedRecyclingTenant(posMenuScope.session.tenant_id) && !canUseStandard){
    await requirePosPagePermission("sales:list:view");
    return <RecyclingSalesListPageContent scope={posMenuScope} search={options}/>;
  }
  // A CUSTOM Optical contract can read its basic bill history without buying
  // advanced_sales_reports. Never grant report exports or bill mutations here.
  // Optical stores that explicitly purchased advanced reports keep the full
  // existing reporting page; the read-only alternative is for basic contracts.
  const basicOptical = await requireOpticalRetailEntitlement(posMenuScope.session.tenant_id) &&
    !await hasBranchFeature(posMenuScope.session.tenant_id, posMenuScope.session.branch_id, "advanced_sales_reports");
  if (basicOptical) {
    requirePermission(posMenuScope, "sales:list:view");
    const lang = await getCurrentLanguage();
    const branchRole = posMenuScope.session.role as BranchRole;
    const history = await loadPosSalesListData({
      userId: posMenuScope.session.user_id,
      tenantId: posMenuScope.session.tenant_id,
      branchId: posMenuScope.session.branch_id,
      branchRole,
      platformRole: "tenant_user"
    });
    return <PosOpticalBasicSalesHistory lang={lang} initialRecords={history.records}
      initialBranches={history.branchOptions} />;
  }
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
