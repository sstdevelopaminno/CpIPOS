import { fail, ok } from "@/lib/http";
import {PosGuardError,requireActiveShift,requirePermission,requirePosSession} from "@/lib/pos-session-guard";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {getTenantPosCurrencyCode} from "@/lib/server/custom-pos-currency";
import {requireOpticalFinanceModule} from "@/lib/server/optical-finance-policy";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Input={
 order_request_id?:string;payment_request_id?:string;customer_id?:string;
 items?:Array<{product_id?:string;quantity?:number}>;discount_lak?:number;
 amount_lak?:number;method?:"cash"|"bank_transfer";due_date?:string;
 reference_no?:string;manager_verified?:boolean;
};

/** Atomic create + deposit. Never reserve stock without its confirmed ledger entry. */
export async function POST(request:Request){
 try{
  const origin=request.headers.get("origin");
  if(origin){
   try{if(new URL(origin).host!==new URL(request.url).host)
     return fail("optical_origin_denied","Invalid payment origin",403);}
   catch{return fail("optical_origin_denied","Invalid payment origin",403);}
  }
  if(!request.headers.get("content-type")?.toLowerCase().includes("application/json"))
    return fail("optical_payment_content_type","JSON required",415);
  const scope=await requirePosSession();
  requirePermission(scope,"sale:create");
  const {shift}=await requireActiveShift(scope);
  if(await getTenantPosCurrencyCode(scope.session.tenant_id)!=="LAK")
    return fail("optical_finance_currency_not_ready","Optical finance currently accepts LAK only.",403);
  const [workOrdersAllowed,depositsAllowed]=await Promise.all([
   requireOpticalFinanceModule(scope.session.tenant_id,"optical_work_orders"),
   requireOpticalFinanceModule(scope.session.tenant_id,"optical_deposit")
  ]);
  if(!workOrdersAllowed||!depositsAllowed)
    return fail("optical_finance_disabled","ระบบรับมัดจำของร้านยังไม่ได้เปิดใช้งาน กรุณาให้ฝ่าย IT เปิดสิทธิ์ Optical Finance ระดับร้านครั้งเดียว และเปิดใช้งานระบบการเงินบน Vercel (ไม่ต้องให้ IT อนุมัติทุกบิล)",403);
  const body=await request.json().catch(()=>null) as Input|null;
  if(!body||!uuid.test(body.order_request_id??"")||!uuid.test(body.payment_request_id??"")||
    body.order_request_id===body.payment_request_id||!uuid.test(body.customer_id??"")||
    !Array.isArray(body.items)||body.items.length===0||body.items.length>30||
    body.items.some(item=>!uuid.test(item.product_id??"")||!Number.isInteger(item.quantity)
      ||Number(item.quantity)<1||Number(item.quantity)>999999)||
    !Number.isSafeInteger(body.discount_lak??0)||Number(body.discount_lak??0)<0||
    !Number.isSafeInteger(body.amount_lak)||Number(body.amount_lak)<=0||
    !["cash","bank_transfer"].includes(body.method??""))
    return fail("optical_atomic_payment_invalid","Verify items, customer, LAK amount and request IDs.",422);
  if(typeof body.due_date!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(body.due_date)||
     !Number.isFinite(Date.parse(body.due_date+"T12:00:00+07:00"))){
     return fail("optical_due_date_required","กรุณาระบุวันนัดรับแว่นให้ถูกต้อง",422);
  }
  const transfer=body.method==="bank_transfer";
  const reference=String(body.reference_no??"").trim();
  const role=String(scope.session.role??"").toLowerCase();
  if(transfer){
   if(role!=="owner"&&role!=="manager")
    return fail("optical_transfer_manager_required","Owner or Manager must verify actual bank credit.",403);
   if(body.manager_verified!==true||reference.length<6||reference.length>120||/[\r\n]/.test(reference))
    return fail("optical_transfer_proof_required","Bank reference and manager attestation required.",422);
  }
  // Independent customer/stock checks, amounts and unique payment requests
  // are enforced again by the SQL transaction while holding row locks.
  const {data,error}=await getSupabaseServiceClient().rpc("optical_open_with_deposit_due_v1",{
   p_tenant_id:scope.session.tenant_id,
   p_branch_id:scope.session.branch_id,
   p_actor:scope.session.user_id,
   p_shift_id:shift.id,
   p_customer_id:body.customer_id,
   p_seller_id:scope.session.user_id,
   p_items:body.items,
   p_discount_lak:body.discount_lak??0,
   p_order_request_id:body.order_request_id,
   p_payment_request_id:body.payment_request_id,
   p_amount_lak:body.amount_lak,
   p_method:body.method,
   p_transfer_reference:transfer?reference:null,
   p_verified_by:transfer?scope.session.user_id:null,
   p_due_date:body.due_date
  });
  if(error){
   console.error("[optical-atomic-deposit] transaction rejected",{code:error.code});
   return fail("optical_atomic_deposit_rejected",
    "Unable to confirm Optical order and payment atomically. Verify stock, customer, ledger and bank evidence.",409);
  }
  const result=Array.isArray(data)?data[0]:null;
  if(!result?.work_order_id||!result?.payment_id)
   return fail("optical_atomic_receipt_unavailable","Payment confirmation not returned.",503);
  return ok({work_order_id:result.work_order_id,payment_id:result.payment_id,
   paid_total:result.paid_total,remaining_amount:result.remaining_amount,
   duplicate_request:result.duplicate_request===true});
 }catch(error){
  if(error instanceof PosGuardError)return fail(error.code,error.message,error.status);
  return fail("optical_atomic_deposit_failed","Optical deposit unavailable.",503);
 }
}
