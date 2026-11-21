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
  if (await isAuthorizedRecyclingTenant(posMenuScope.session.tenant_id)) {
    return <RecyclingShiftHistoryPageContent />;
  }
  const lang = await getCurrentLanguage();
  return <PosShiftHistoryModule lang={lang} />;
}

