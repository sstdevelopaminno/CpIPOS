import { fail, ok } from "@/lib/http";
import { FeatureGateError } from "@/lib/feature-gate";
import { requirePosSession, requirePermission, PosGuardError } from "@/lib/pos-session-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE=/^\d{4}-\d{2}-\d{2}$/;

/**
 * Creates an append-only, supervisor-scoped document-date correction REQUEST.
 * It NEVER changes recycling_transactions.created_at, the receipt number,
 * stock/cash, tax records, GL posting or shift chronology. Finance must
 * separately review accounting-period and VAT effects before amendment.
 */
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const origin=request.headers.get("origin");
  if(origin&&new URL(origin).origin!==new URL(request.url).origin)
   return fail("recycling_date_request_origin_invalid","Same-origin POS request required",403);
  const {id}=await params;
  if(!UUID.test(id))return fail("recycling_date_request_id_invalid","Invalid document ID",422);
  const scope=await requirePosSession();
  requirePermission(scope,"sales:list:view");
  if(!["owner","manager","accountant"].includes(scope.session.role))
   return fail("recycling_date_request_role_denied","Supervisor or accountant required",403);
  if(!await isAuthorizedRecyclingTenant(scope.session.tenant_id))
   return fail("recycling_date_request_mode_denied","CUSTOM Recycling required",403);
  if(process.env.RECYCLING_DIRECT_DATE_EDIT_ENABLED==="1")return fail("recycling_date_request_retired","กรุณารีเฟรชหน้าจอและบันทึกวันเวลาโดยตรง",410);
  const raw=await request.json().catch(()=>null) as Record<string,unknown>|null;
  const requestId=typeof raw?.request_id==="string"?raw.request_id:"";
  const requestedDate=typeof raw?.requested_date==="string"?raw.requested_date:"";
  const reason=typeof raw?.reason==="string"?raw.reason.trim():"";
  if(!UUID.test(requestId)||!DATE.test(requestedDate)||reason.length<10||reason.length>500)
   return fail("recycling_date_request_invalid","Specify a valid date, a reason (10–500 characters) and a unique request ID",422);
  const validDate=new Date(requestedDate+"T00:00:00Z");
  if(!Number.isFinite(validDate.getTime())||validDate.toISOString().slice(0,10)!==requestedDate)
   return fail("recycling_date_request_invalid_date","Invalid calendar date",422);
  const todayParts=new Intl.DateTimeFormat("en-CA",{
   timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(new Date());
  const part=(type:string)=>todayParts.find(x=>x.type===type)?.value??"";
  const today=part("year")+"-"+part("month")+"-"+part("day");
  if(requestedDate>today||validDate.getTime()<Date.now()-370*86400000)
   return fail("recycling_date_request_date_out_of_range","Requested date is future or outside review window",422);
  const db=getSupabaseServiceClient();
  const existing=await db.from("audit_logs")
   .select("id,tenant_id,branch_id,action,target_id")
   .eq("id",requestId).maybeSingle();
  if(existing.error)throw new Error("recycling_date_request_audit_lookup_failed");
  if(existing.data){
   if(existing.data.tenant_id!==scope.session.tenant_id||
      existing.data.branch_id!==scope.session.branch_id||
      existing.data.target_id!==id||
      existing.data.action!=="recycling_document_date_correction_requested")
    return fail("recycling_date_request_conflicting_id","Request ID already used",409);
   return ok({accepted:true,request_id:requestId,applied:false,duplicate:true});
  }
  const tx=await db.from("recycling_transactions")
   .select("id,receipt_no,created_at,status,direction,finance_document_id,tax_state,shift_id")
   .eq("id",id).eq("tenant_id",scope.session.tenant_id)
   .eq("branch_id",scope.session.branch_id).maybeSingle();
  if(tx.error)throw new Error("recycling_date_request_document_lookup_failed");
  if(!tx.data||tx.data.status!=="posted")
   return fail("recycling_date_request_document_unavailable","Only posted documents in this branch may request correction",409);
  const audit=await db.from("audit_logs").insert({
   id:requestId,
   tenant_id:scope.session.tenant_id,branch_id:scope.session.branch_id,
   actor_user_id:scope.session.user_id,actor_role:scope.session.role,
   user_id:scope.session.user_id,role:scope.session.role,
   action:"recycling_document_date_correction_requested",
   target_table:"recycling_transactions",target_id:id,
   module:"recycling",entity_type:"recycling_transaction",entity_id:id,
   device_code:scope.session.device_code,
   pos_session_id:scope.session.id,
   before_data:{created_at:tx.data.created_at,receipt_no:tx.data.receipt_no,status:tx.data.status},
   after_data:{requested_document_date:requestedDate,reason,approval_status:"pending_accountant_review"},
   metadata:{
    request_id:requestId,
    source:"custom_recycling_sales_list",
    correction_type:"document_date",
    original_timestamp_immutable:true,
    posted_gl_document_id:tx.data.finance_document_id,
    tax_state:tx.data.tax_state,
    shift_id:tx.data.shift_id,
    no_stock_cash_tax_mutation:true
   }
  }).select("id").single();
  if(audit.error)throw new Error("recycling_date_request_audit_write_failed");
  return ok({accepted:true,request_id:audit.data.id,applied:false,duplicate:false});
 }catch(error){
  if(error instanceof PosGuardError||error instanceof FeatureGateError)
   return fail(error.code,error.message,error.status);
  console.warn("[recycling/date-correction-request]",{
   code:error instanceof Error?error.message:"unknown"
  });
  return fail("recycling_date_request_failed","Could not store correction request; original document unchanged",503);
 }
}
