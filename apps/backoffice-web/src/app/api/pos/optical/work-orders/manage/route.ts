import {fail,ok} from "@/lib/http";
import {requirePermission,requirePosSession,PosGuardError} from "@/lib/pos-session-guard";
import {requireOpticalRetailEntitlement} from "@/lib/server/optical-entitlement";
import {requireOpticalFinanceModule} from "@/lib/server/optical-finance-policy";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {appendAuditLog} from "@/lib/audit-log";
import type {BranchRole} from "@pos/shared-types";
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const errorResponse=(e:unknown)=>e instanceof PosGuardError?fail(e.code,e.message,e.status):fail("optical_order_action_failed","Unable to process the work order.",503);
export async function GET(request:Request){
 try{
  const scope=await requirePosSession();requirePermission(scope,"sales:list:view");
  if(!await requireOpticalRetailEntitlement(scope.session.tenant_id))
    return fail("optical_denied","Optical mode not approved.",403);
  const id=new URL(request.url).searchParams.get("id");
  if(!id||!uuid.test(id))return fail("invalid_work_order_id","Invalid work order id.",422);
  const db=getSupabaseServiceClient();
  const {data:order,error}=await db.from("optical_work_orders")
    .select("id,customer_id,status,currency_code,total_amount,paid_total,accepted_at,due_at,created_at,note")
    .eq("tenant_id",scope.session.tenant_id).eq("branch_id",scope.session.branch_id)
    .eq("id",id).maybeSingle();
  if(error)return fail("work_order_read_failed","Unable to load work order.",503);
  if(!order)return fail("work_order_not_found","Work order not found in branch.",404);
  const {data:lines,error:lineError}=await db.from("optical_work_order_lines")
    .select("id,sku_snapshot,description_snapshot,quantity,unit_price,line_total")
    .eq("tenant_id",scope.session.tenant_id).eq("branch_id",scope.session.branch_id)
    .eq("work_order_id",id).limit(50);
  if(lineError)return fail("work_order_lines_failed","Unable to load order lines.",503);
  const financeReady=await requireOpticalFinanceModule(scope.session.tenant_id,"optical_work_orders");
  let payments:unknown[]=[];
  if(financeReady){
   const p=await db.from("optical_payment_ledger")
     .select("id,amount,currency_code,method,reference_no,received_at")
     .eq("tenant_id",scope.session.tenant_id).eq("branch_id",scope.session.branch_id)
     .eq("work_order_id",id).order("received_at",{ascending:false}).limit(100);
   if(p.error)return fail("payment_history_failed","Unable to load payment history.",503);
   payments=p.data??[];
  }
  const response=ok({order,lines:lines??[],payments,financeReady,
   canManage:financeReady&&["owner","manager"].includes(String(scope.session.role))});
  response.headers.set("Cache-Control","private, no-store");return response;
 }catch(e){return errorResponse(e);}
}
export async function PATCH(request:Request){
 try{
  const scope=await requirePosSession();requirePermission(scope,"sale:create");
  if(!["owner","manager"].includes(String(scope.session.role)))
    return fail("optical_order_edit_denied","Owner or manager is required.",403);
  if(!await requireOpticalFinanceModule(scope.session.tenant_id,"optical_work_orders"))
    return fail("optical_finance_not_ready","ต้องอนุมัติระบบใบสั่งงานจาก IT และเปิด Optical finance rollout ก่อนแก้ไข/ยกเลิก",403);
  const input=await request.json().catch(()=>null) as {id?:string;action?:string;note?:string;due_at?:string|null;request_id?:string}|null;
  if(!input||!uuid.test(input.id??"")||!uuid.test(input.request_id??"")||
    !["update","cancel"].includes(input.action??"")||
    (input.action==="update"&&(typeof input.note!=="string"||input.note.length>1000||
       (input.due_at!==null&&(typeof input.due_at!=="string"||!Number.isFinite(Date.parse(input.due_at))))))
    )return fail("optical_order_invalid","Invalid work order edit/cancellation request.",422);
  const {data,error}=await getSupabaseServiceClient().rpc("optical_manage_work_order_v1",{
    p_tenant_id:scope.session.tenant_id,p_branch_id:scope.session.branch_id,
    p_work_order_id:input.id,p_actor:scope.session.user_id,
    p_action:input.action,p_request_id:input.request_id,
    p_note:input.note??null,p_due_at:input.due_at??null
  });
  if(error)return fail("optical_order_change_denied",error.message,409);
  await appendAuditLog({tenantId:scope.session.tenant_id,branchId:scope.session.branch_id,
    actorUserId:scope.session.user_id,actorRole:scope.session.role as BranchRole,
    action:input.action==="cancel"?"optical_work_order_cancelled":"optical_work_order_details_updated",
    targetTable:"optical_work_orders",targetId:input.id});
  return ok({result:data});
 }catch(e){return errorResponse(e);}
}
