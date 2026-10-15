import { fail, ok } from "@/lib/http";
import { PosGuardError, requireActiveShift, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { requireOpticalFinanceModule } from "@/lib/server/optical-finance-policy";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function POST(request:Request,{params}:{params:Promise<{workOrderId:string}>}) {
  try {
    const scope=await requirePosSession();
    requirePermission(scope,"sale:create");
    await requireActiveShift(scope);
    if(!await requireOpticalFinanceModule(scope.session.tenant_id,"optical_deposit"))
      return fail("optical_deposit_disabled","Deposit payments require IT approval.",403);
    const {workOrderId}=await params;
    const body=await request.json().catch(()=>null) as {
      request_id?:string;amount_lak?:number;method?:"cash"|"bank_transfer";reference_no?:string
    }|null;
    if(!uuid.test(workOrderId)||!uuid.test(body?.request_id??"")||
      !Number.isSafeInteger(body?.amount_lak)||Number(body?.amount_lak)<=0||
      !["cash","bank_transfer"].includes(body?.method??""))
      return fail("optical_payment_invalid","Invalid LAK payment or request ID.",422);
    // Bank transfers require verifiable manager proof. This route intentionally
    // fails closed until the IT-approved evidence workflow is connected;
    // accepting a UI-provided verification boolean would permit fake deposits.
    if(body?.method==="bank_transfer")
      return fail("optical_transfer_verification_pending","Verified bank transfer workflow is not yet enabled.",403);
    const {data,error}=await getSupabaseServiceClient().rpc("optical_post_deposit_tx",{
      p_tenant_id:scope.session.tenant_id,p_branch_id:scope.session.branch_id,
      p_work_order_id:workOrderId,p_actor:scope.session.user_id,
      p_request_id:body!.request_id,p_amount_lak:body!.amount_lak,
      p_method:"cash",p_transfer_reference:null,p_verified_by:null
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
