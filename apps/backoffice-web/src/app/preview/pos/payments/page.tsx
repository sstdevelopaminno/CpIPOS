import { redirect } from "next/navigation";
import { PosSubscriptionCenter } from "@/components/pos-preview/pos-subscription-center";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosSession } from "@/lib/pos-session-guard";
import { loadPosSubscriptionCenter } from "@/lib/services/pos-subscription-center-service";

export const dynamic = "force-dynamic";

export default async function PosPaymentsPage() {
  const scope = await requirePosSession();
  if (!["owner","manager"].includes(scope.session.role)) redirect("/preview/pos");
  await assertPosMenuPageAllowed(scope.session.tenant_id,"/preview/pos/payments");
  const data = await loadPosSubscriptionCenter(scope.session.tenant_id);
  return <PosSubscriptionCenter initial={data} isOwner={scope.session.role==="owner"} />;
}
