import { redirect } from "next/navigation";
import { KitchenManagement } from "@/components/kitchen/kitchen-management";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosSession } from "@/lib/pos-session-guard";

export default async function PosKitchenManagementPage() {
  const scope = await requirePosSession();
  if (scope.session.role !== "owner" && scope.session.role !== "manager") {
    redirect("/preview/pos/more");
  }
  const lang = await getCurrentLanguage();
  return <KitchenManagement lang={lang} />;
}
