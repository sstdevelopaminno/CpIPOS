import { redirect } from "next/navigation";
import { PosMoreWorkspace } from "@/components/pos-preview/pos-more-workspace";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosSession } from "@/lib/pos-session-guard";

export default async function PosMorePage() {
  const scope = await requirePosSession();
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
