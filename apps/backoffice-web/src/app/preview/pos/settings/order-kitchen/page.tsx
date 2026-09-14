import { OrderKitchenSettingsPage } from "@/components/pos-preview/order-kitchen-settings-page";
import { requireTenantFeature } from "@/lib/feature-gate";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function PosOrderKitchenSettingsPage() {
  const scope = await requirePosPagePermission("tables:manage");
  await requireTenantFeature(scope.session.tenant_id, "qr_table_ordering", scope.session.branch_id);
  const lang = await getCurrentLanguage();
  return <OrderKitchenSettingsPage lang={lang} />;
}
