import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosSession } from "@/lib/pos-session-guard";
import { PosShiftHistoryModule } from "@/components/pos/pos-shift-history-module";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import RecyclingShiftHistoryPageContent from "@/components/pos/recycling-shift-history-page-content";

export default async function PosShiftPage() {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/shift");
  await requirePosPagePermission("shift:join");

  // A Recycling entitlement owns this route, including stale ?mode=general URLs.
  // Do not mount the ordinary POS shift component or a second navigation shell.
  if (await isAuthorizedRecyclingTenant(posMenuScope.session.tenant_id)) {
    return <RecyclingShiftHistoryPageContent />;
  }

  // All other packages retain the original screen and its CSS/layout.
  const lang = await getCurrentLanguage();
  return <PosShiftHistoryModule lang={lang} />;
}
