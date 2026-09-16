import { PosGeneralSaleModeController } from "@/components/pos/pos-general-sale-mode-controller";
import { PosSalesModePolicyController } from "@/components/pos/pos-sales-mode-policy-controller";
import { PosSalesModule } from "@/components/pos/pos-sales-module";
import { getCurrentLanguage } from "@/lib/i18n";

export default async function PosSalesPage() {
  const lang = await getCurrentLanguage();
  return (
    <>
      <PosSalesModule lang={lang} />
      <PosGeneralSaleModeController />
      <PosSalesModePolicyController />
    </>
  );
}
