import { notFound } from "next/navigation";
import { requirePosSession } from "@/lib/pos-session-guard";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { getCurrentLanguage } from "@/lib/i18n";
import { KitchenConditionsSettingsPage } from "@/components/pos-preview/kitchen-conditions-settings-page";

export default async function PosKitchenConditionsSettingsRoute() {
  const scope = await requirePosSession();
  // The new submenu inherits the existing Kitchen Settings IT navigation policy.
  await assertPosMenuPageAllowed(scope.session.tenant_id, "/preview/pos/settings/order-kitchen");
  await requirePosPagePermission("settings:view", "/preview/pos/settings");
  if (scope.session.role !== "owner" && scope.session.role !== "manager") notFound();
  const lang = await getCurrentLanguage();
  return <KitchenConditionsSettingsPage lang={lang} />;
}
