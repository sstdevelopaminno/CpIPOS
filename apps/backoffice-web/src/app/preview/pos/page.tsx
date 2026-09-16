import { PosCustomerDisplayV2PaymentObserver } from "@/components/pos/pos-customer-display-v2-payment-observer";
import { PosCustomerDisplayV2Publisher } from "@/components/pos/pos-customer-display-v2-publisher";
import { PosDineInCommitResetBoundary } from "@/components/pos/pos-dine-in-commit-reset-boundary";
import { PosGeneralSaleRuntime } from "@/components/pos/pos-general-sale-runtime";
import { PosGeneralSaleTableController } from "@/components/pos/pos-general-sale-table-controller";
import { PosGroceryTableOnlyGuard } from "@/components/pos/pos-grocery-table-only-guard";
import { getCurrentLanguage } from "@/lib/i18n";
import { requirePosPagePermission } from "@/lib/pos-page-guard";

export default async function PosPreviewPage() {
  await requirePosPagePermission("sale:create", "/login/store");
  const lang = await getCurrentLanguage();

  return (
    <main className="h-full min-h-0 w-full">
      <PosCustomerDisplayV2Publisher />
      <PosCustomerDisplayV2PaymentObserver />
      <PosDineInCommitResetBoundary lang={lang} />
      <PosGroceryTableOnlyGuard />
      <PosGeneralSaleTableController />
      <PosGeneralSaleRuntime />
    </main>
  );
}
