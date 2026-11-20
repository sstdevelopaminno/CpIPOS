import { PosCustomerDisplayV2PaymentObserver } from "@/components/pos/pos-customer-display-v2-payment-observer";
import { PosCustomerDisplayV2Publisher } from "@/components/pos/pos-customer-display-v2-publisher";
import { PosDineInCommitResetBoundary } from "@/components/pos/pos-dine-in-commit-reset-boundary";
import { PosGeneralSaleRuntime } from "@/components/pos/pos-general-sale-runtime";
import { PosGeneralSaleTableController } from "@/components/pos/pos-general-sale-table-controller";
import { PosEntryGate } from "@/components/pos/pos-entry-gate";
import { RecyclingLegacyModeOption } from "@/components/pos/recycling-sales-mode-switcher";
import type { Language } from "@/lib/i18n";

/** The ordinary POS's original React header, cart, shift and mode selector. */
export function PosLegacySalesContent({lang,tenantId,branchId,recyclingEnabled = false}:{
  lang: Language;
  tenantId:string;
  branchId:string;
  recyclingEnabled?:boolean;
}) {
 return <main className="h-full min-h-0 w-full">
   <PosCustomerDisplayV2Publisher />
   <PosCustomerDisplayV2PaymentObserver />
   <PosDineInCommitResetBoundary lang={lang} />
   <PosGeneralSaleTableController lang={lang} />
   <PosGeneralSaleRuntime />
   {recyclingEnabled ? <RecyclingLegacyModeOption /> : null}
   <PosEntryGate lang={lang} initialScope={{tenantId,branchId}} />
 </main>;
}
