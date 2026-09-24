import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosSession } from "@/lib/pos-session-guard";
import { TableManagementPage } from "@/components/tables/table-management-page";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function PosTablesPage() {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/tables");
  const scope = await requirePosPagePermission("tables:manage");
  const lang = await getCurrentLanguage();
  return <TableManagementPage lang={lang} initialRole={scope.session.role} />;
}
