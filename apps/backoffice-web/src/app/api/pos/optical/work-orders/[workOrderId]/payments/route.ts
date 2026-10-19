import { fail, ok } from "@/lib/http";
import { PosGuardError, requireActiveShift, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import {getTenantPosCurrencyCode} from "@/lib/server/custom-pos-currency";
import { requireOpticalFinanceModule,isOpticalItApiControlAllowed,OPTICAL_IT_API_CONTROLS } from "@/lib/server/optical-finance-policy";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request:Request,{params}:{params:Promise<{workOrderId:string}>}) {
  try {
    const scope=await requirePosSession();
    requirePermission(scope,"sale:create");
    const {shift}=await requireActiveShift(scope);
    if (await getTenantPosCurrencyCode(scope.session.tenant_id)!=="LAK") return fail("optical_finance_currency_not_ready","Deposit finance is currently LAK-only.",403);
    if(!await requireOpticalFinanceModule(scope.session.tenant_id,"optical_deposit"))
      return fail("optical_deposit_disabled","Deposit payments require IT approval.",403);
    const {workOrderId}=await params;
    const body=await request.json().catch(()=>null) as {
      request_id?:string;amount_lak?:number;method?:"cash"|"bank_transfer";reference_no?:string;manager_verified?:boolean
    }|null;
    if(!uuid.test(workOrderId)||!uuid.test(body?.request_id??"")||
      !Number.isSafeInteger(body?.amount_lak)||Number(body?.amount_lak)<=0||
      !["cash","bank_transfer"].includes(body?.method??""))
      return fail("optical_payment_invalid","Invalid LAK payment or request ID.",422);
    const transfer=body?.method==="bank_transfer";
    const reference=String(body?.reference_no??"").trim();
    const role=String(scope.session.role??"").toLowerCase();
    // Never trust the browser checkbox as financial proof. Only an authenticated
    // branch Owner/Manager can attest, after independently checking the actual
    // bank-account credit. The ledger keeps the manager user ID and reference.
    // This is *manual verification*, not an automatic bank-provider confirmation.
    if(transfer){
    if(!await isOpticalItApiControlAllowed(scope.session.tenant_id,OPTICAL_IT_API_CONTROLS.optical_payment_verification))
      return fail("optical_transfer_it_disabled","IT disabled Optical bank-transfer verification.",403);
      if(role!=="owner"&&role!=="manager")
        return fail("optical_transfer_manager_required","Owner or Manager must verify the actual bank deposit.",403);
      if(body?.manager_verified!==true || reference.length<6 || reference.length>120 || /[\r\n]/.test(reference))
        return fail("optical_transfer_proof_required","Verified bank statement reference and Owner/Manager attestation required.",422);
    }
    const {data,error}=await getSupabaseServiceClient().rpc("optical_post_deposit_tx",{
      p_tenant_id:scope.session.tenant_id,p_branch_id:scope.session.branch_id,
      p_work_order_id:workOrderId,p_actor:scope.session.user_id,
      p_shift_id:shift.id,p_request_id:body!.request_id,p_amount_lak:body!.amount_lak,
      p_method:transfer?"bank_transfer":"cash",p_transfer_reference:transfer?reference:null,p_verified_by:transfer?scope.session.user_id:null
    });
    if(error)return fail("optical_deposit_rejected","Payment was rejected; verify bill status and outstanding balance.",409);
    const entry=Array.isArray(data)?data[0]:null;
    if(!entry?.payment_id)return fail("optical_payment_missing","Payment confirmation was not returned.",500);
    return ok({payment_id:entry.payment_id,paid_total:entry.paid_total,
      remaining_amount:entry.remaining_amount,duplicate_request:entry.duplicate_request===true});
  }catch(error){
    return error instanceof PosGuardError
      ? fail(error.code,error.message,error.status)
      : fail("optical_payment_failed","Unable to process Optical payment.",503);
  }
}
