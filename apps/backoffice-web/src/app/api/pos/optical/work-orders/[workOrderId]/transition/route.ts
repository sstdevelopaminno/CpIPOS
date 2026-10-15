import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { requireOpticalFinanceModule } from "@/lib/server/optical-finance-policy";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowed=["lens_ordered","edging","ready_for_pickup","collected","cancelled"] as const;
export async function POST(request:Request,{params}:{params:Promise<{workOrderId:string}>}) {
  try {
    const scope=await requirePosSession();
    requirePermission(scope,"sale:create");
    if(!await requireOpticalFinanceModule(scope.session.tenant_id,"optical_work_orders"))
      return fail("optical_work_orders_disabled","Optical work orders require IT approval.",403);
    const {workOrderId}=await params;
    const input=await request.json().catch(()=>null) as {request_id?:string;next_status?:string}|null;
    if(!uuid.test(workOrderId)||!uuid.test(input?.request_id??"")||
      !allowed.some(status=>status===input?.next_status))
      return fail("optical_transition_invalid","Invalid work order transition.",422);
    if(input?.next_status==="collected"&&
      !await requireOpticalFinanceModule(scope.session.tenant_id,"optical_deposit"))
      return fail("optical_collection_denied","Financial handover has not been approved.",403);
    const {data,error}=await getSupabaseServiceClient().rpc("optical_transition_work_order_tx",{
      p_tenant_id:scope.session.tenant_id,p_branch_id:scope.session.branch_id,
      p_work_order_id:workOrderId,p_actor:scope.session.user_id,
      p_next_status:input!.next_status,p_request_id:input!.request_id
    });
    if(error)return fail("optical_transition_rejected","Work order status, stock or balance does not permit this action.",409);
    const changed=Array.isArray(data)?data[0]:null;
    if(!changed)return fail("optical_transition_missing","No transition result returned.",500);
    return ok({status:changed.status,duplicate_request:changed.duplicate_request===true});
  }catch(error){
    return error instanceof PosGuardError
      ? fail(error.code,error.message,error.status)
      : fail("optical_transition_failed","Unable to update Optical order.",503);
  }
}
