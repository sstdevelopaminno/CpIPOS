import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { PosSalesPageDenied } from "@/lib/pos-sales-page-denial";
import { PosSalesAccessNotice } from "@/components/pos/pos-sales-access-notice";
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
  // Guard once, then use the verified scope; never render a cashier on denial.
  const posMenuScope = await (async () => {
    try {
      const scope = await requirePosPagePermission("sale:create", "/login/store", true);
      await assertPosMenuPageAllowed(scope.session.tenant_id, "/preview/pos", true);
      return scope;
    } catch (error) {
      if (error instanceof PosSalesPageDenied) return error;
      throw error;
    }
  })();
  if (posMenuScope instanceof PosSalesPageDenied) {
    return <PosSalesAccessNotice reason={posMenuScope.reason} lang={await getCurrentLanguage()} />;
  }

  // Recycling is the selected IT CUSTOM selling workspace, rendered at the
  // original /preview/pos entry without routing away from the POS shell.
  // Other tenants retain ALL original React POS controllers below unchanged.
  if (await isAuthorizedRecyclingTenant(posMenuScope.session.tenant_id)) {
    return <RecyclingSalesContent
      tenantId={posMenuScope.session.tenant_id}
      branchId={posMenuScope.session.branch_id}
      deviceCode={posMenuScope.session.device_code ?? null}
      operatorUserId={posMenuScope.session.user_id}/>;
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
