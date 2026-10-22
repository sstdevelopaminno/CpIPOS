import {fail,ok} from "@/lib/http";
import {requirePosSession,requirePermission,PosGuardError} from "@/lib/pos-session-guard";
import {requireOpticalRetailEntitlement} from "@/lib/server/optical-entitlement";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {appendAuditLog} from "@/lib/audit-log";
import type {BranchRole} from "@pos/shared-types";
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const bad=(e:unknown)=>e instanceof PosGuardError?fail(e.code,e.message,e.status):fail("optical_customer_action_failed","Unable to process this request.",503);
async function scoped(write=false){
 const scope=await requirePosSession();requirePermission(scope,write?"sale:create":"sales:list:view");
 if(!await requireOpticalRetailEntitlement(scope.session.tenant_id))throw new Error("optical_denied");
 return scope;
}
/** Read customer details and all historical eye examinations, tenant/branch-scoped. */
export async function GET(request:Request){
 try{
  const scope=await scoped();
  const id=new URL(request.url).searchParams.get("id");
  if(!id||!uuid.test(id))return fail("invalid_customer_id","Invalid customer ID.",422);
  const client=getSupabaseServiceClient();
  const {data:customer,error}=await client.from("optical_customers")
    .select("id,customer_code,full_name,phone,age,examiner_name,last_exam_date,previous_prescription,notes")
    .eq("tenant_id",scope.session.tenant_id).eq("branch_id",scope.session.branch_id)
    .eq("id",id).is("deleted_at",null).maybeSingle();
  if(error)return fail("customer_load_failed","Unable to load customer.",503);
  if(!customer)return fail("customer_not_found","Customer not found.",404);
  const {data:exams,error:historyError}=await client.from("optical_eye_exams")
    .select("id,examined_at,right_sph,right_cyl,right_axis,right_add,left_sph,left_cyl,left_axis,left_add,pd_mm,examiner_name")
    .eq("tenant_id",scope.session.tenant_id).eq("branch_id",scope.session.branch_id).eq("customer_id",id)
    .order("examined_at",{ascending:false}).limit(40);
  if(historyError)return fail("exam_load_failed","Unable to load eye-exam history.",503);
  const response=ok({customer,exams:exams??[],canArchive:["owner","manager"].includes(String(scope.session.role))});
  response.headers.set("Cache-Control","private, no-store");return response;
 }catch(e){return e instanceof Error&&e.message==="optical_denied"?fail("optical_denied","Optical mode not approved.",403):bad(e);}
}
export async function PATCH(request:Request){
 try{
  const scope=await scoped(true);
  const body=await request.json().catch(()=>null) as {id?:string;full_name?:string;phone?:string;age?:number|null;notes?:string;previous_prescription?:string}|null;
  if(!body||!uuid.test(body.id??"")||typeof body.full_name!=="string"||!body.full_name.trim()
   ||body.full_name.trim().length>240||typeof body.phone!=="string"||body.phone.length>48
   ||typeof body.notes!=="string"||body.notes.length>1500
   ||typeof body.previous_prescription!=="string"||body.previous_prescription.length>1000
   ||(body.age!=null&&(!Number.isInteger(body.age)||body.age<0||body.age>130)))
   return fail("customer_invalid","Check name, age and contact information.",422);
  const {data,error}=await getSupabaseServiceClient().from("optical_customers")
    .update({full_name:body.full_name.trim(),phone:body.phone.trim()||null,age:body.age??null,
      notes:body.notes.trim()||null,previous_prescription:body.previous_prescription.trim()||null,
      updated_by:scope.session.user_id,updated_at:new Date().toISOString()})
    .eq("tenant_id",scope.session.tenant_id).eq("branch_id",scope.session.branch_id)
    .eq("id",body.id).is("deleted_at",null).select("id").maybeSingle();
  if(error)return fail("customer_edit_failed","Could not update this customer.",503);
  if(!data)return fail("customer_not_found","Customer not found.",404);
  await appendAuditLog({tenantId:scope.session.tenant_id,branchId:scope.session.branch_id,
   actorUserId:scope.session.user_id,actorRole:scope.session.role as BranchRole,
   action:"optical_customer_identity_updated",targetTable:"optical_customers",targetId:data.id});
  return ok({id:data.id});
 }catch(e){return e instanceof Error&&e.message==="optical_denied"?fail("optical_denied","Optical mode not approved.",403):bad(e);}
}
/** "Delete" is archive. Never delete exams or financial rows. */
export async function DELETE(request:Request){
 try{
  const scope=await scoped(true);
  if(!["owner","manager"].includes(String(scope.session.role)))
    return fail("archive_denied","Owner or manager is required.",403);
  const body=await request.json().catch(()=>null) as {id?:string}|null;
  if(!uuid.test(body?.id??""))return fail("invalid_customer_id","Invalid customer ID.",422);
  const db=getSupabaseServiceClient();
  const {data:orders,error:orderError}=await db.from("optical_work_orders").select("id")
    .eq("tenant_id",scope.session.tenant_id).eq("branch_id",scope.session.branch_id)
    .eq("customer_id",body!.id!).neq("status","cancelled").limit(1);
  if(orderError)return fail("customer_archive_check_failed","Unable to verify linked work orders.",503);
  if(orders?.length)return fail("customer_has_work_orders","Customer has active work orders; archive is blocked.",409);
  const {data,error}=await db.from("optical_customers")
   .update({deleted_at:new Date().toISOString(),updated_at:new Date().toISOString(),updated_by:scope.session.user_id})
   .eq("tenant_id",scope.session.tenant_id).eq("branch_id",scope.session.branch_id)
   .eq("id",body!.id!).is("deleted_at",null).select("id").maybeSingle();
  if(error)return fail("customer_archive_failed","Could not archive this customer.",503);
  if(!data)return fail("customer_not_found","Customer not found.",404);
  await appendAuditLog({tenantId:scope.session.tenant_id,branchId:scope.session.branch_id,
   actorUserId:scope.session.user_id,actorRole:scope.session.role as BranchRole,
   action:"optical_customer_archived",targetTable:"optical_customers",targetId:data.id});
  return ok({id:data.id});
 }catch(e){return e instanceof Error&&e.message==="optical_denied"?fail("optical_denied","Optical mode not approved.",403):bad(e);}
}
