import { fail, ok } from "@/lib/http";
import { PosGuardError, requireActiveShift, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { requireOpticalFinanceModule } from "@/lib/server/optical-finance-policy";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const denied = () => fail("optical_work_orders_disabled","Optical work orders require IT approval and QA rollout.",403);
const errorResponse = (error: unknown) => error instanceof PosGuardError
  ? fail(error.code,error.message,error.status)
  : fail("optical_work_order_unavailable","Unable to access Optical work orders.",503);

export async function GET() {
  try {
    const scope = await requirePosSession();
    requirePermission(scope,"sales:list:view");
    if (!await requireOpticalFinanceModule(scope.session.tenant_id,"optical_work_orders")) return denied();
    const { data,error }=await getSupabaseServiceClient().from("optical_work_orders")
      .select("id,customer_id,eye_exam_id,seller_id,status,currency_code,total_amount,paid_total,accepted_at,due_at,collected_at")
      .eq("tenant_id",scope.session.tenant_id)
      .eq("branch_id",scope.session.branch_id)
      .order("created_at",{ascending:false}).limit(100);
    if(error) return fail("optical_work_order_query_failed","Cannot load optical orders.",503);
    return ok({orders:data??[]});
  }catch(error){return errorResponse(error);}
}

export async function POST(request:Request) {
  try {
    const scope=await requirePosSession();
    requirePermission(scope,"sale:create");
    await requireActiveShift(scope);
    if (!await requireOpticalFinanceModule(scope.session.tenant_id,"optical_work_orders")) return denied();
    const body=await request.json().catch(()=>null) as {
      request_id?:string; customer_id?:string; eye_exam_id?:string|null;
      items?:Array<{product_id?:string;quantity?:number}>; discount_lak?:number;
      due_at?:string|null;note?:string|null
    }|null;
    if(!body||!uuid.test(body.request_id??"")||!uuid.test(body.customer_id??"")||
      (body.eye_exam_id && !uuid.test(body.eye_exam_id))||
      !Array.isArray(body.items)||body.items.length===0||body.items.length>30||
      body.items.some(i=>!uuid.test(i.product_id??"")||!Number.isInteger(i.quantity)||Number(i.quantity)<1||Number(i.quantity)>999999)||
      !Number.isSafeInteger(body.discount_lak??0)||Number(body.discount_lak??0)<0||
      (body.due_at!=null && !Number.isFinite(Date.parse(body.due_at))))
      return fail("optical_invalid_work_order","Please check customer, items and LAK discount.",422);
    const {data,error}=await getSupabaseServiceClient().rpc("optical_create_work_order_tx",{
      p_tenant_id:scope.session.tenant_id,p_branch_id:scope.session.branch_id,
      p_actor:scope.session.user_id,p_customer_id:body.customer_id,
      p_eye_exam_id:body.eye_exam_id??null,
      p_items:body.items,p_discount_lak:body.discount_lak??0,
      p_request_id:body.request_id,p_due_at:body.due_at??null,p_note:body.note??null
    });
    if(error)return fail("optical_work_order_transaction_failed","Could not reserve Optical stock. Check availability and access.",409);
    const entry=Array.isArray(data)?data[0]:null;
    if(!entry?.work_order_id)return fail("optical_work_order_missing","Work order was not returned.",500);
    return ok({work_order_id:entry.work_order_id,duplicate_request:entry.duplicate_request===true});
  }catch(error){return errorResponse(error);}
}
