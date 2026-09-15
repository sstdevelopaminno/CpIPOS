import { OrderKitchenSettingsPage } from "@/components/pos-preview/order-kitchen-settings-page";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function PosOrderKitchenSettingsPage() {
  await requirePosPagePermission("settings:view", "/preview/pos/settings");
  const lang = await getCurrentLanguage();
  return <OrderKitchenSettingsPage lang={lang} />;
}
