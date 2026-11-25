/** Shared readiness policy for the VAT quote and checkout presentation. */
export type RecyclingVatBlocker =
  | "recycling_vat_release_disabled"
  | "recycling_vat_settings_unsupported"
  | "recycling_vat_registration_not_verified"
  | "recycling_vat_account_not_ready"
  | "recycling_vat_schema_not_ready";

export function recyclingVatBlockers(args: {
  configured:boolean;rollout:boolean;ruleValid:boolean;verified:boolean;accountReady:boolean;
}): RecyclingVatBlocker[] {
  if (!args.configured) return [];
  const blockers:RecyclingVatBlocker[]=[];
  if (!args.ruleValid) blockers.push("recycling_vat_settings_unsupported");
  if (!args.verified) blockers.push("recycling_vat_registration_not_verified");
  if (!args.accountReady) blockers.push("recycling_vat_account_not_ready");
  return blockers;
}

const messages:Record<RecyclingVatBlocker,string> = {
  recycling_vat_release_disabled:"ระบบบันทึกภาษีขายยังไม่พร้อมใช้งาน",
  recycling_vat_settings_unsupported:"ตรวจสอบการตั้งค่าภาษีของสาขา: ต้องเป็น VAT 7% แบบบวกเพิ่มเพียงหนึ่งรายการ",
  recycling_vat_registration_not_verified:"ฝ่ายบัญชียังไม่ได้ยืนยันหลักฐานการจดทะเบียน VAT ของสาขา",
  recycling_vat_account_not_ready:"ฝ่ายบัญชียังไม่ได้จัดเตรียมบัญชีภาษีขาย 2200 ประเภทหนี้สิน",
  recycling_vat_schema_not_ready:"ไม่สามารถตรวจสอบฐานข้อมูลภาษีหรือผังบัญชีได้ กรุณาติดต่อฝ่าย IT"
};
export function recyclingVatBlockerMessage(code:string):string {
  return Object.prototype.hasOwnProperty.call(messages,code)
    ? messages[code as RecyclingVatBlocker]
    : "ยังตรวจสอบความพร้อมของภาษีไม่ได้ กรุณาติดต่อฝ่ายบัญชี";
}
