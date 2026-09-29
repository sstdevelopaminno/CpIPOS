import { redirect } from "next/navigation";
import { PosHelpCenter } from "@/components/pos-preview/pos-help-center";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosSession } from "@/lib/pos-session-guard";

export const dynamic = "force-dynamic";

export default async function PosHelpCenterPage() {
  const scope = await requirePosSession();
  if (scope.session.role === "kitchen") redirect("/preview/pos");
  await assertPosMenuPageAllowed(scope.session.tenant_id, "/preview/pos/payments");
  return <PosHelpCenter />;
}
