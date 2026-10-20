import { cookies } from "next/headers";
import { fail, ok } from "@/lib/http";
import { readPreEntryFlowState,hasFlowStage } from "@/lib/server/pre-entry-state";
import { authorizePreEntryPackageCheckout,submitPublicPackageCheckout } from "@/lib/services/public-package-checkout-service";
import { generateBillingPromptPayQr } from "@/lib/payments/promptpay-billing-qr";
import {buildRateLimitKey,enforceRateLimit,getClientIpAddress} from "@/lib/server/rate-limit";

export const dynamic="force-dynamic";
export const runtime="nodejs";
const MAX_BODY=4*1024*1024+16000;
async function context(){
  const flow=readPreEntryFlowState(await cookies());
  if(!flow || !hasFlowStage(flow,["employee_verified"]) ||
     !flow.tenantId || !flow.userId || !flow.userRole || !flow.branchId)return null;
  return flow;
}
const errorMap:Record<string,[string,number]>={
  subscription_support_required:["กรุณาติดต่อฝ่าย IT เพื่อดำเนินการชำระเงินหรือปลดล็อกร้าน",423],
  internal_demo_not_billable:["ร้านทดสอบไม่สามารถชำระแพ็กเกจได้",422],
  checkout_token_invalid:["รายการชำระหมดอายุ กรุณาโหลดหน้านี้ใหม่",401],
  checkout_context_mismatch:["บัญชีพนักงานหรือร้านค้าไม่ตรงกับรายการนี้",403],
  package_price_changed:["ยอดชำระมีการเปลี่ยนแปลง กรุณาโหลดใหม่",409],
  open_request_exists:["มีคำขอชำระเงินที่รอการตรวจสอบอยู่แล้ว",409],
  package_price_missing:["ไม่พบยอดชำระที่ถูกต้อง",422],
  receiving_account_not_configured:["ฝ่าย IT ยังไม่ได้ตั้งค่าบัญชีรับชำระ",503],
  slip_required:["กรุณาแนบสลิป JPG PNG หรือ WebP ไม่เกิน 4 MB",422],
  slip_type_invalid:["ไฟล์สลิปไม่ถูกต้อง",422]
};
function responseError(error:unknown){
  const code=error instanceof Error?error.message:"checkout_failed";
  const mapped=errorMap[code];
  return mapped?fail(code,mapped[0],mapped[1]):fail("checkout_failed","ไม่สามารถดำเนินการชำระแพ็กเกจได้ กรุณาติดต่อ Support",503);
}
export async function GET(){
  const flow=await context();
  if(!flow)return fail("employee_verification_required","กรุณาเข้าสู่ระบบร้านและยืนยันพนักงานก่อน",401);
  try{
    const quote=await authorizePreEntryPackageCheckout({
      tenantId:flow.tenantId,userId:flow.userId!,userRole:flow.userRole!
    });
    const amount=quote.package.amount;
    const promptPay=quote.issuer.promptpay_id || "";
    const qr_data_url=quote.token && amount>0 && promptPay
      ?await generateBillingPromptPayQr(promptPay,amount):null;
    const response=ok({...quote,qr_data_url});
    response.headers.set("Cache-Control","private, no-store, max-age=0");
    return response;
  }catch(e){return responseError(e);}
}
export async function POST(request:Request){
  const flow=await context();
  if(!flow)return fail("employee_verification_required","กรุณายืนยันพนักงานก่อน",401);
  const origin=request.headers.get("origin");
  if(origin && origin!==new URL(request.url).origin)
    return fail("origin_invalid","ไม่อนุญาตคำขอจากเว็บไซต์อื่น",403);
  if(Number(request.headers.get("content-length")||0)>MAX_BODY)
    return fail("upload_too_large","ไฟล์สลิปเกิน 4 MB",413);
  const limit=await enforceRateLimit({
    namespace:"preentry_package_checkout",
    key:buildRateLimitKey({namespace:"preentry-checkout",parts:[getClientIpAddress(request),flow.tenantId,flow.userId!]}),
    max:6,windowMs:10*60_000,failClosedOnBackendError:true
  });
  if(!limit.ok)return fail("rate_limited","ส่งคำขอบ่อยเกินไป กรุณาลองใหม่ภายหลัง",429);
  const form=await request.formData().catch(()=>null);
  const token=form?.get("checkout_token");
  const slip=form?.get("slip");
  if(typeof token!=="string" || !(slip instanceof File))return fail("slip_required","กรุณาแนบสลิป",422);
  try{
    const result=await submitPublicPackageCheckout({
      token,slip,note:String(form?.get("note")||"").slice(0,500),
      authenticatedContext:{tenantId:flow.tenantId,userId:flow.userId!,role:flow.userRole!}
    });
    const response=ok(result);
    response.headers.set("Cache-Control","private, no-store, max-age=0");
    return response;
  }catch(e){return responseError(e);}
}
