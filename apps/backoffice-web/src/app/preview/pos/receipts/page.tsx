import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { authorizeOpticalMoreMenu } from "@/lib/server/optical-more-feature-access";
import { PosReceiptsWorkspace } from "@/components/pos-preview/pos-receipts-workspace";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { requireOpticalRetailEntitlement } from "@/lib/server/optical-entitlement";

export default async function PosReceiptsPage() {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/receipts");
  const opticalAllowed = await authorizeOpticalMoreMenu(posMenuScope.session.tenant_id, posMenuScope.session.branch_id, "more.receipts");
  if (opticalAllowed) requirePermission(posMenuScope, "receipts:view");
  else await requirePosPagePermission("receipts:view");
  const lang = await getCurrentLanguage();

  const opticalMode = await requireOpticalRetailEntitlement(posMenuScope.session.tenant_id);
  return <PosReceiptsWorkspace lang={lang} opticalMode={opticalMode} />;
}
