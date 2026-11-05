import { PosKitchenScreen } from "@/components/pos-preview/pos-kitchen-screen";
import { requirePosSession } from "@/lib/pos-session-guard";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { getCurrentLanguage } from "@/lib/i18n";

export default async function PosKitchenPage() {
  const [scope, language] = await Promise.all([requirePosSession(), getCurrentLanguage()]);
  await assertPosMenuPageAllowed(scope.session.tenant_id, "/preview/pos/kitchen");
  return <PosKitchenScreen language={language} />;
}
