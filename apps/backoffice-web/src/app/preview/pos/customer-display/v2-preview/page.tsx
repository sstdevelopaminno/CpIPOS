import { PosCustomerDisplayV2VisualPreview } from "@/components/pos/pos-customer-display-v2-visual-preview";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function PosCustomerDisplayV2PreviewPage() {
  await requirePosPagePermission("customer_display:manage");
  const lang = await getCurrentLanguage();
  return <PosCustomerDisplayV2VisualPreview lang={lang} />;
}
