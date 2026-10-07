import { redirect } from "next/navigation";
import { PosSupportCenter } from "@/components/pos-preview/pos-support-center";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosSessionForShiftClose } from "@/lib/pos-session-guard";
import { loadPosSubscriptionCenter } from "@/lib/services/pos-subscription-center-service";

export const dynamic = "force-dynamic";

export default async function PosSupportPage() {
  const scope = await requirePosSessionForShiftClose();
  if (scope.session.role === "kitchen") redirect("/preview/pos");
  await assertPosMenuPageAllowed(scope.session.tenant_id, "/preview/pos/payments/support");
  const data = await loadPosSubscriptionCenter(scope.session.tenant_id);
  return <PosSupportCenter storeCode={data.store.code} storeName={data.store.name} supportEmail={data.issuer.support_email} />;
}
