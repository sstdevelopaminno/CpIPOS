import { isAuthorizedCustomGeneralSaleTenant } from "@/lib/server/recycling-general-sale-entitlement";
import { RecyclingHistoryReports } from "@/components/pos/recycling-history-reports";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import type { RecyclingReportQuery } from "@/lib/server/recycling-history-reports";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { authorizeOpticalMoreMenu } from "@/lib/server/optical-more-feature-access";
import { PosReceiptsWorkspace } from "@/components/pos-preview/pos-receipts-workspace";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { requireOpticalRetailEntitlement } from "@/lib/server/optical-entitlement";

export default async function PosReceiptsPage({searchParams}:{searchParams?:Promise<RecyclingReportQuery>}) {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/receipts");
  // CUSTOM Recycling has an independent purchases/sales ledger. Do not show empty legacy order reports.
  const requestedMode = (await searchParams)?.report_mode;
  const canUseStandard = requestedMode === "standard" &&
    await isAuthorizedCustomGeneralSaleTenant(posMenuScope.session.tenant_id);
  if (await isAuthorizedRecyclingTenant(posMenuScope.session.tenant_id) && !canUseStandard) {
    await requirePosPagePermission("receipts:view");
    return <RecyclingHistoryReports scope={posMenuScope} kind="receipts" search={await searchParams} />;
  }
  const opticalAllowed = await authorizeOpticalMoreMenu(posMenuScope.session.tenant_id, posMenuScope.session.branch_id, "more.receipts");
  if (opticalAllowed) requirePermission(posMenuScope, "receipts:view");
  else await requirePosPagePermission("receipts:view");
  const lang = await getCurrentLanguage();

  const opticalMode = await requireOpticalRetailEntitlement(posMenuScope.session.tenant_id);
  return <PosReceiptsWorkspace lang={lang} opticalMode={opticalMode} />;
}
