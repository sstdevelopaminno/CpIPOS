import { PosCustomerDisplayV2Live } from "@/components/pos/pos-customer-display-v2-live";
import { getCurrentLanguage } from "@/lib/i18n";

export default async function CustomerDisplayV2Page() {
  const lang = await getCurrentLanguage();
  return <PosCustomerDisplayV2Live lang={lang} />;
}
