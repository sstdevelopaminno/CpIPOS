/** POS terminal entry: report the actual entitlement/lifecycle reason without changing billing state. */
export type PosEntryContract={status:string;ended_at:string|null;package_id?:string|null}|null;
export type PosEntryLifecycle={
 lifecycle_status:string;access_locked:boolean;lock_reason:string|null;
 trial_expires_at:string|null;subscription_expires_at:string|null;grace_until:string|null;
 metadata?:Record<string,unknown>|null;
}|null;
export type PosEntryDenialCode =
 "trial_expired"|"subscription_expired"|"subscription_locked"|"subscription_inactive"|
 "subscription_missing"|"feature_not_enabled";
export type PosEntryDenial={
 code:PosEntryDenialCode;title:string;message:string;expires_at:string|null;kind:"subscription"|"feature";
};
const expiryPassed=(iso:string|null|undefined,now:number)=>Boolean(iso&&Number.isFinite(Date.parse(iso))&&Date.parse(iso)<=now);
export function classifyPosEntryDenial(
 contract:PosEntryContract,lifecycle:PosEntryLifecycle,
 now:number=Date.now()
):PosEntryDenial|null {
 const exempt=Boolean(lifecycle?.lifecycle_status==="sales_demo"||lifecycle?.metadata?.quota_exempt===true);
 const trial=contract?contract.status==="trial":lifecycle?.lifecycle_status==="trial";
 // Never assume a missing payment from a blocked sale. "Trial ended" is not a paid invoice.
 const expiry=trial
   ?contract?.ended_at??lifecycle?.trial_expires_at??null
   :contract?.ended_at??lifecycle?.subscription_expires_at??null;
 if(!exempt && expiryPassed(expiry,now)){
   return trial?{
     code:"trial_expired",kind:"subscription",title:"แพ็กเกจทดลองใช้งานสิ้นสุดแล้ว",
     message:"ระยะเวลาทดลองใช้งานครบกำหนดแล้ว กรุณาติดต่อฝ่าย Support เพื่อตรวจสอบการต่ออายุหรือเปิดใช้งานแพ็กเกจ",
     expires_at:expiry
   }:{
     code:"subscription_expired",kind:"subscription",title:"แพ็กเกจสิ้นสุดระยะเวลาใช้งานแล้ว",
     message:"แพ็กเกจครบกำหนด กรุณาตรวจสอบสถานะต่ออายุหรือการชำระเงินกับฝ่าย Support",
     expires_at:expiry
   };
 }
 if(!exempt&&lifecycle?.access_locked){
   return {code:"subscription_locked",kind:"subscription",title:"การใช้งานแพ็กเกจถูกระงับชั่วคราว",
     message:"ระบบจำกัดการเข้าใช้งานชั่วคราว กรุณาติดต่อฝ่าย Support เพื่อตรวจสอบสถานะบัญชีและแพ็กเกจ",
     expires_at:expiry};
 }
 if(!contract){
   return {code:"subscription_missing",kind:"subscription",title:"ยังไม่พบแพ็กเกจที่เปิดใช้งาน",
     message:"กรุณาติดต่อฝ่าย Support เพื่อตรวจสอบการกำหนดแพ็กเกจของร้าน",expires_at:null};
 }
 if(!["active","trial"].includes(contract.status)){
   return {code:"subscription_inactive",kind:"subscription",title:"แพ็กเกจยังไม่พร้อมใช้งาน",
     message:"สถานะแพ็กเกจไม่ได้เปิดใช้งาน กรุณาติดต่อฝ่าย Support เพื่อยืนยันสถานะ",expires_at:expiry};
 }
 return null;
}
export function unavailablePosFeatureDenial():PosEntryDenial{
 return {code:"feature_not_enabled",kind:"feature",title:"แพ็กเกจยังไม่เปิดสิทธิ์หน้าขาย",
   message:"ไม่พบสิทธิ์ใช้งานหน้าขายในแพ็กเกจหรือสาขานี้ กรุณาติดต่อฝ่าย Support เพื่อตรวจสอบสิทธิ์ POS",
   expires_at:null};
}
