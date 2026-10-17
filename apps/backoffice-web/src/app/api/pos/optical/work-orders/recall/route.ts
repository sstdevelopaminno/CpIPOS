import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { parseOpticalBillRecallCode } from "@/lib/optical/optical-deposit-contract";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { requireOpticalFinanceModule } from "@/lib/server/optical-finance-policy";

export async function GET(request: Request) {
  try {
    const scope=await requirePosSession();
    requirePermission(scope,"sales:list:view");
    if(!await requireOpticalFinanceModule(scope.session.tenant_id,"optical_deposit"))
      return fail("optical_recall_disabled","Deposit recall is not enabled for this store.",403);
    const id=parseOpticalBillRecallCode(new URL(request.url).searchParams.get("code")??"");
    if(!id)return fail("invalid_optical_recall","Invalid QR or bill reference.",422);
    const {data,error}=await getSupabaseServiceClient().from("optical_work_orders")
      .select("id,status,total_amount,paid_total,currency_code,customer_id,due_at")
      .eq("id",id).eq("tenant_id",scope.session.tenant_id)
      .eq("branch_id",scope.session.branch_id).maybeSingle();
    if(error)return fail("optical_recall_failed","Unable to locate the bill.",503);
    if(!data||Number(data.paid_total)<=0||
      Number(data.paid_total)>=Number(data.total_amount)||
      ["cancelled","collected"].includes(String(data.status)))
      return fail("optical_bill_not_collectable","Bill is paid, cancelled, unavailable or cannot accept additional payment.",409);
    return ok({bill:data,remaining_amount:Number(data.total_amount)-Number(data.paid_total)});
  }catch(error){
    return error instanceof PosGuardError
      ? fail(error.code,error.message,error.status)
      : fail("optical_recall_failed","Unable to validate the Optical bill.",503);
  }
}
