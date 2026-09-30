import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { redirect } from "next/navigation";
import { PosMoreWorkspace } from "@/components/pos-preview/pos-more-workspace";
import { getCurrentLanguage } from "@/lib/i18n";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";

export default async function PosMorePage() {
  let scope;
  try {
    scope = await requirePosSession();
  } catch (error) {
    if (error instanceof PosGuardError && error.status === 401) redirect("/login/employee");
    throw error;
  }
  await assertPosMenuPageAllowed(scope.session.tenant_id, "/preview/pos/more");
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
