import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosSession } from "@/lib/pos-session-guard";
import { PosUsersModule } from "@/components/pos/pos-users-module";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function PosUsersPage() {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos/users");
  await requirePosPagePermission("users:view");
  const lang = await getCurrentLanguage();

  return <PosUsersModule lang={lang} />;
}
