import { PosGeneralSaleRuntime } from "@/components/pos/pos-general-sale-runtime";
import { PosGeneralSaleTableController } from "@/components/pos/pos-general-sale-table-controller";
import { PosSalesModePolicyController } from "@/components/pos/pos-sales-mode-policy-controller";
import { PosSalesModule } from "@/components/pos/pos-sales-module";
import { getCurrentLanguage } from "@/lib/i18n";

export default async function PosSalesPage() {
  const lang = await getCurrentLanguage();
  return (
    <>
      <PosSalesModule lang={lang} />
      <PosGeneralSaleTableController />
      <PosGeneralSaleRuntime />
      <PosSalesModePolicyController />
    </>
  );
}
