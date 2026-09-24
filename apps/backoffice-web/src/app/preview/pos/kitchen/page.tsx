import { PosKitchenScreen } from "@/components/pos-preview/pos-kitchen-screen";
import { requirePosSession } from "@/lib/pos-session-guard";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";

export default async function PosKitchenPage() {
  const scope = await requirePosSession();
  await assertPosMenuPageAllowed(scope.session.tenant_id, "/preview/pos/kitchen");
  return <PosKitchenScreen />;
}
