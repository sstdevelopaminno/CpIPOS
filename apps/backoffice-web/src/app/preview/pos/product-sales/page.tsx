import { isAuthorizedCustomGeneralSaleTenant } from "@/lib/server/recycling-general-sale-entitlement";
import { RecyclingHistoryReports } from "@/components/pos/recycling-history-reports";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import type { RecyclingReportQuery } from "@/lib/server/recycling-history-reports";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { authorizeOpticalMoreMenu } from "@/lib/server/optical-more-feature-access";
import { ProductSalesWorkspace } from "@/components/pos-preview/product-sales-workspace";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { requireOpticalRetailEntitlement } from "@/lib/server/optical-entitlement";

export default async function ProductSalesPage({searchParams}:{searchParams?:Promise<RecyclingReportQuery>}) {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/product-sales");
  // CUSTOM Recycling has an independent purchases/sales ledger. Do not show empty legacy order reports.
  const requestedMode = (await searchParams)?.report_mode;
  const canUseStandard = requestedMode === "standard" &&
    await isAuthorizedCustomGeneralSaleTenant(posMenuScope.session.tenant_id, posMenuScope.session.branch_id);
  if (await isAuthorizedRecyclingTenant(posMenuScope.session.tenant_id) && !canUseStandard) {
    await requirePosPagePermission("sales:list:view");
    return <RecyclingHistoryReports scope={posMenuScope} kind="products" search={await searchParams} />;
  }
  const opticalAllowed = await authorizeOpticalMoreMenu(posMenuScope.session.tenant_id, posMenuScope.session.branch_id, "more.product_sales");
  const scope = opticalAllowed ? posMenuScope : await requirePosPagePermission("sales:list:view");
  if (opticalAllowed) requirePermission(scope, "sales:list:view");
  const lang = await getCurrentLanguage();
  const opticalMode = await requireOpticalRetailEntitlement(scope.session.tenant_id);
  const role = String(scope.session.role ?? "staff");
  const canViewAllBranches = role === "owner" || role === "manager" || role === "accountant";

  return (
    <ProductSalesWorkspace
      lang={lang}
      opticalMode={opticalMode}
      canViewAllBranches={canViewAllBranches}
      initialBranchId={scope.session.branch_id}
    />
  );
}
