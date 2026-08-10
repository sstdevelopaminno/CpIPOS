import { redirect } from "next/navigation";
import { KitchenSettingsPanel } from "@/components/kitchen/kitchen-settings-panel";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function KitchenSettingsPage() {
  const scope = await requirePosPagePermission("settings:view");
  if (scope.session.role !== "owner" && scope.session.role !== "manager") {
    redirect("/preview/pos/kitchen");
  }
  return <KitchenSettingsPanel />;
}
