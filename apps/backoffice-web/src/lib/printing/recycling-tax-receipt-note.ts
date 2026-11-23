import type { TaxSettings } from "@/lib/services/pos-settings-service";

/** Ordinary Recycling proof is never a tax invoice. Keep the message concise
 * enough for thermal 58/80mm rolls without implying VAT was recorded. */
export const RECYCLING_RECEIPT_ACCOUNTING_NOTICE =
  "เอกสารซื้อขายทั่วไป ไม่ใช่ใบกำกับภาษี หากต้องการใบกำกับภาษี กรุณาติดต่อฝ่ายบัญชี";

export function recyclingReceiptTaxNotice(settings:TaxSettings|null|undefined):string{
  if(settings?.is_enabled && settings.lines.some(line=>line.is_active)){
    return RECYCLING_RECEIPT_ACCOUNTING_NOTICE+" · ยอดนี้ไม่ได้แยกภาษี";
  }
  return RECYCLING_RECEIPT_ACCOUNTING_NOTICE;
}
