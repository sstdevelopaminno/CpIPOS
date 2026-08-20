import { PosCustomerDisplayV2Native } from "@/components/pos/pos-customer-display-v2-native";
import { getCurrentLanguage } from "@/lib/i18n";

export default async function CustomerDisplayV2NativePage() {
  const lang = await getCurrentLanguage();
  return <PosCustomerDisplayV2Native lang={lang} />;
}
