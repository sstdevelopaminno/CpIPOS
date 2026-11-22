import type { TaxSettings } from "@/lib/services/pos-settings-service";

/** The existing recycling_post_transaction writes a tax-unsegregated total.
 * This is not a tax invoice; do not invent VAT/withholding on a receipt by
 * applying configurable POS tax rates retroactively to an already paid sum.
 */
export function recyclingReceiptTaxNotice(settings:TaxSettings|null|undefined):string{
  if(settings?.is_enabled && settings.lines.some(line=>line.is_active)){
    return "เอกสารซื้อขายทั่วไป ไม่ใช่ใบกำกับภาษี · ตั้งค่าภาษีของสาขาเปิดอยู่ แต่ยอดธุรกรรมนี้ไม่ได้บันทึกภาษีแยก กรุณาตรวจสอบกับฝ่ายบัญชีก่อนออกเอกสารภาษี";
  }
  return "เอกสารซื้อขายทั่วไป ไม่ใช่ใบกำกับภาษี";
}
