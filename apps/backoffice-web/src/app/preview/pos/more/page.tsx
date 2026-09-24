import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { redirect } from "next/navigation";
import { PosMoreWorkspace } from "@/components/pos-preview/pos-more-workspace";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosSession } from "@/lib/pos-session-guard";

export default async function PosMorePage() {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/more");
  const scope = await requirePosSession();
  if (scope.session.role === "kitchen") {
    redirect("/preview/pos/kitchen");
  }
  if (scope.session.role === "staff") {
    redirect("/preview/pos");
  }
  const lang = await getCurrentLanguage();
  const role =
    scope.session.role === "owner" || scope.session.role === "manager" || scope.session.role === "accountant"
      ? scope.session.role
      : "staff";
  return <PosMoreWorkspace lang={lang} role={role} />;
}
