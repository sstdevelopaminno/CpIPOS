import { PosCustomerDisplayV2Setup } from "@/components/pos/pos-customer-display-v2-setup";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function PosCustomerDisplayV2SetupPage() {
  await requirePosPagePermission("customer_display:manage");
  const lang = await getCurrentLanguage();
  return <PosCustomerDisplayV2Setup lang={lang} />;
}
