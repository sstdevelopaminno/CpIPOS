import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosSession } from "@/lib/pos-session-guard";
import { OrderKitchenSettingsPage } from "@/components/pos-preview/order-kitchen-settings-page";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function PosOrderKitchenSettingsPage() {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/settings/order-kitchen");
  await requirePosPagePermission("settings:view", "/preview/pos/settings");
  const lang = await getCurrentLanguage();
  return <OrderKitchenSettingsPage lang={lang} />;
}
