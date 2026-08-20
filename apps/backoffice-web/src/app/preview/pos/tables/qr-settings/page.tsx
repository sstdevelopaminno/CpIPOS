import { redirect } from "next/navigation";
import { TableQrSettingsPage } from "@/components/tables/table-qr-settings-page";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosSession } from "@/lib/pos-session-guard";

export default async function TableQrSettingsRoute() {
  const scope = await requirePosSession();
  if (scope.session.role !== "owner" && scope.session.role !== "manager") {
    redirect("/preview/pos/more");
  }
  const lang = await getCurrentLanguage();
  return <TableQrSettingsPage lang={lang} />;
}
