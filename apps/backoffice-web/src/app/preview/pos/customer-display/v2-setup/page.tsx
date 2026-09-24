import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosSession } from "@/lib/pos-session-guard";
import { PosCustomerDisplayV2Setup } from "@/components/pos/pos-customer-display-v2-setup";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function PosCustomerDisplayV2SetupPage() {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/customer-display/v2-setup");
  await requirePosPagePermission("customer_display:manage");
  const lang = await getCurrentLanguage();
  return <PosCustomerDisplayV2Setup lang={lang} />;
}
