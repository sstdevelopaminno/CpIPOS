import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosSession } from "@/lib/pos-session-guard";
import { PosCustomerDisplayV2VisualPreview } from "@/components/pos/pos-customer-display-v2-visual-preview";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function PosCustomerDisplayV2PreviewPage() {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/customer-display/v2-preview");
  await requirePosPagePermission("customer_display:manage");
  const lang = await getCurrentLanguage();
  return <PosCustomerDisplayV2VisualPreview lang={lang} />;
}
