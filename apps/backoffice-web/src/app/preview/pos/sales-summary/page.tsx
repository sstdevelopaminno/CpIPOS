import { isAuthorizedCustomGeneralSaleTenant } from "@/lib/server/recycling-general-sale-entitlement";
import { RecyclingHistoryReports } from "@/components/pos/recycling-history-reports";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import type { RecyclingReportQuery } from "@/lib/server/recycling-history-reports";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { authorizeOpticalMoreMenu } from "@/lib/server/optical-more-feature-access";
import type { BranchRole } from "@pos/shared-types";
import { PosSalesSummaryDashboard } from "@/components/pos-preview/pos-sales-summary-dashboard";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { loadPosSalesSummaryData } from "@/lib/services/pos-sales-summary-service";
import styles from "./sales-summary-responsive.module.css";
import { requireOpticalRetailEntitlement } from "@/lib/server/optical-entitlement";

export default async function PosSalesSummaryPage({searchParams}:{searchParams?:Promise<RecyclingReportQuery>}) {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/sales-summary");
  // CUSTOM Recycling has an independent purchases/sales ledger. Do not show empty legacy order reports.
  const requestedMode = (await searchParams)?.report_mode;
  const canUseStandard = requestedMode === "standard" &&
    await isAuthorizedCustomGeneralSaleTenant(posMenuScope.session.tenant_id, posMenuScope.session.branch_id);
  if (await isAuthorizedRecyclingTenant(posMenuScope.session.tenant_id) && !canUseStandard) {
    await requirePosPagePermission("reports:view");
    return <RecyclingHistoryReports scope={posMenuScope} kind="summary" search={await searchParams} />;
  }
  const opticalAllowed = await authorizeOpticalMoreMenu(posMenuScope.session.tenant_id, posMenuScope.session.branch_id, "more.sales_summary");
  const scope = opticalAllowed ? posMenuScope : await requirePosPagePermission("reports:view");
  if (opticalAllowed) requirePermission(scope, "reports:view");
  const lang = await getCurrentLanguage();
  const opticalMode = await requireOpticalRetailEntitlement(scope.session.tenant_id);
  const initialPayload = await loadPosSalesSummaryData({
    userId: scope.session.user_id,
    tenantId: scope.session.tenant_id,
    branchId: scope.session.branch_id,
    branchRole: scope.session.role as BranchRole,
    platformRole: "tenant_user"
  });

  return (
    <div className={styles.page}>
      <PosSalesSummaryDashboard lang={lang} initialPayload={initialPayload} opticalMode={opticalMode} />
    </div>
  );
}
