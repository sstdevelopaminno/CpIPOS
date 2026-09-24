import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosSession } from "@/lib/pos-session-guard";
import { PosCustomerDisplayModule } from "@/components/pos/pos-customer-display-module";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function PosPreviewCustomerDisplayPage() {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/customer-display");
  await requirePosPagePermission("customer_display:manage");
  const lang = await getCurrentLanguage();
  return <PosCustomerDisplayModule lang={lang} />;
}

