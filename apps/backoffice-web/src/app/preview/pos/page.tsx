import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosSession } from "@/lib/pos-session-guard";
import { PosCustomerDisplayV2PaymentObserver } from "@/components/pos/pos-customer-display-v2-payment-observer";
import { PosCustomerDisplayV2Publisher } from "@/components/pos/pos-customer-display-v2-publisher";
import { PosDineInCommitResetBoundary } from "@/components/pos/pos-dine-in-commit-reset-boundary";
import { PosGeneralSaleRuntime } from "@/components/pos/pos-general-sale-runtime";
import { PosGeneralSaleTableController } from "@/components/pos/pos-general-sale-table-controller";
import { PosEntryGate } from "@/components/pos/pos-entry-gate";
import { RecyclingSalesContent } from "@/components/pos/recycling-sales-content";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";

export const dynamic = "force-dynamic";

export default async function PosPreviewPage() {
  const posMenuScope = await requirePosSession();
  await assertPosMenuPageAllowed(posMenuScope.session.tenant_id, "/preview/pos");
  await requirePosPagePermission("sale:create", "/login/store");

  // Recycling is the selected IT CUSTOM selling workspace, rendered at the
  // original /preview/pos entry without routing away from the POS shell.
  // Other tenants retain ALL original React POS controllers below unchanged.
  if (await isAuthorizedRecyclingTenant(posMenuScope.session.tenant_id)) {
    return <RecyclingSalesContent
      tenantId={posMenuScope.session.tenant_id}
      branchId={posMenuScope.session.branch_id}
      deviceCode={posMenuScope.session.device_code ?? null}/>;
  }

  const lang = await getCurrentLanguage();
  return (
    <main className="h-full min-h-0 w-full">
      <PosCustomerDisplayV2Publisher />
      <PosCustomerDisplayV2PaymentObserver />
      <PosDineInCommitResetBoundary lang={lang} />
      <PosGeneralSaleTableController lang={lang} />
      <PosGeneralSaleRuntime />
      <PosEntryGate lang={lang} initialScope={{ tenantId: posMenuScope.session.tenant_id, branchId: posMenuScope.session.branch_id }} />
    </main>
  );
}
