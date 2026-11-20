import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosSession } from "@/lib/pos-session-guard";
import { PosLegacySalesContent } from "@/components/pos/pos-legacy-sales-content";
import { RecyclingSalesContent } from "@/components/pos/recycling-sales-content";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";

export const dynamic = "force-dynamic";

export default async function PosPreviewPage() {
  const scope = await requirePosSession();
  await assertPosMenuPageAllowed(scope.session.tenant_id, "/preview/pos");
  await requirePosPagePermission("sale:create", "/login/store");

  // The existing "หน้าขาย" entry remains the canonical route. CUSTOM Recycling
  // replaces only the content inside the original POS shell, not the shell,
  // sidebar or a grocery feature grant. No unconditional redirect/overlay.
  if (await isAuthorizedRecyclingTenant(scope.session.tenant_id)) {
    return <RecyclingSalesContent
      tenantId={scope.session.tenant_id}
      branchId={scope.session.branch_id}
      deviceCode={scope.session.device_code ?? null}/>;
  }

  const lang = await getCurrentLanguage();
  return <PosLegacySalesContent
    lang={lang}
    tenantId={scope.session.tenant_id}
    branchId={scope.session.branch_id}/>;
}
