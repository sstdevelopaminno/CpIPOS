import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosSession } from "@/lib/pos-session-guard";
import { PosReceiptsWorkspace } from "@/components/pos-preview/pos-receipts-workspace";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function PosReceiptsPage() {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/receipts");
  await requirePosPagePermission("receipts:view");
  const lang = await getCurrentLanguage();

  return <PosReceiptsWorkspace lang={lang} />;
}
