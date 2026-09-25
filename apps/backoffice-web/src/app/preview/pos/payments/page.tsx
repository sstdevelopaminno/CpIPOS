import { redirect } from "next/navigation";
import { PosSubscriptionBilling } from "@/components/pos/pos-subscription-billing";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosSession } from "@/lib/pos-session-guard";
import { loadPosSubscriptionWorkspace } from "@/lib/services/pos-subscription-billing-service";

export const dynamic = "force-dynamic";

export default async function PosPaymentsPage() {
  const scope = await requirePosSession();
  if (scope.session.role === "kitchen") redirect("/preview/pos/kitchen");
  await assertPosMenuPageAllowed(scope.session.tenant_id, "/preview/pos/payments");
  const details = await loadPosSubscriptionWorkspace(scope.session.tenant_id, scope.session.role);
  return <PosSubscriptionBilling data={details} />;
}
