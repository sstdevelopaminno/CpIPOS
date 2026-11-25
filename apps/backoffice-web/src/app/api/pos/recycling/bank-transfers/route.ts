import { fail, ok } from "@/lib/http";
import { PosGuardError, requireActiveShift, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { UUID,readLine,isRecyclingDirection } from "@/lib/recycling-transaction-input";

export const dynamic="force-dynamic";
const enabled=()=>process.env.RECYCLING_BANK_TRANSFERS_ENABLED==="1";
const reviewer=(role:string)=>["owner","manager","accountant"].includes(role);
const isUuid=(value:unknown):value is string=>typeof value==="string"&&UUID.test(value);
function safeError(error:unknown){
  if(error instanceof PosGuardError||error instanceof FeatureGateError)return fail(error.code,error.message,error.status);
  return fail("recycling_bank_request_failed","ไม่สามารถยืนยันผลได้ กรุณาตรวจสอบรายการเดิมก่อนส่งซ้ำ",503);
}
async function authorized(){
  const scope=await requirePosSession();
  if(!await isAuthorizedRecyclingTenant(scope.session.tenant_id))return null;
  return scope;
}
export async function GET(){
  if(!enabled())return fail("recycling_bank_not_ready","ยังไม่เปิดระบบตรวจสอบเงินโอน",503);
  try{
    const scope=await authorized();
    if(!scope)return fail("recycling_not_authorized","ไม่มีสิทธิ์",403);
    if(!reviewer(scope.session.role))requirePermission(scope,"sale:create");
    const {tenant_id,branch_id,user_id,role}=scope.session;
    const db=getSupabaseServiceClient();
    let query=db.from("recycling_bank_transfer_intents").select("id,request_id,operator_user_id,direction,counterparty_name,expected_minor,evidence_id,created_at").eq("tenant_id",tenant_id).eq("branch_id",branch_id);
    if(!reviewer(role))query=query.eq("operator_user_id",user_id);
    const [intents,accounts]=await Promise.all([query.order("created_at",{ascending:false}).limit(100),
      db.from("recycling_bank_accounts").select("id,bank_code,account_last4,account_label").eq("tenant_id",tenant_id).eq("branch_id",branch_id).eq("active",true)]);
    if(intents.error||accounts.error)return fail("recycling_bank_unavailable","ตรวจสอบสถานะเงินโอนไม่สำเร็จ",503);
    return ok({intents:intents.data??[],accounts:accounts.data??[],can_review:reviewer(role),actor_id:user_id});
  }catch(e){return safeError(e);}
}
export async function POST(request:Request){
  if(!enabled())return fail("recycling_bank_not_ready","ยังไม่เปิดระบบตรวจสอบเงินโอน",503);
  try{
    const scope=await authorized();
    if(!scope)return fail("recycling_not_authorized","ไม่มีสิทธิ์",403);
    requirePermission(scope,"sale:create");
    const {tenant_id,branch_id,user_id}=scope.session;
    await requireTenantFeature(tenant_id,"core_pos_sales",branch_id);
    const {shift}=await requireActiveShift(scope);
    const raw=await request.json().catch(()=>null) as Record<string,unknown>|null;
    if(!raw||!isUuid(raw.request_id)||!isRecyclingDirection(raw.direction)||typeof raw.expected_minor!=="number"||!Number.isSafeInteger(raw.expected_minor)||raw.expected_minor<=0||raw.expected_minor>99999999999999||!Array.isArray(raw.lines)||raw.lines.length<1||raw.lines.length>100)return fail("recycling_bank_invalid_intent","ข้อมูลคำขอไม่ถูกต้อง",422);
    const lines=raw.lines.map(readLine);
    const name=typeof raw.counterparty_name==="string"?raw.counterparty_name.trim()||"-":"-";
    if(lines.some(line=>line===null)||name.length>240)return fail("recycling_bank_invalid_intent","ข้อมูลรายการไม่ถูกต้อง",422);
    const {data,error}=await getSupabaseServiceClient().rpc("recycling_submit_bank_transfer_intent",{p_tenant_id:tenant_id,p_branch_id:branch_id,p_shift_id:shift.id,p_user_id:user_id,p_request_id:raw.request_id,p_direction:raw.direction,p_counterparty_name:name,p_lines:lines,p_expected_minor:raw.expected_minor});
    if(error)return fail("recycling_bank_intent_rejected","ไม่สามารถสร้างคำขอได้ ตรวจสอบกะ บัญชีธนาคาร และคำขอเดิม",409);
    return ok({intent_id:data});
  }catch(e){return safeError(e);}
}
export async function PATCH(request:Request){
  if(!enabled())return fail("recycling_bank_not_ready","ยังไม่เปิดระบบตรวจสอบเงินโอน",503);
  try{
    const scope=await authorized();
    if(!scope||!reviewer(scope.session.role))return fail("recycling_bank_reviewer_forbidden","เฉพาะผู้มีสิทธิ์ตรวจสอบเงินโอน",403);
    const {tenant_id,branch_id,user_id}=scope.session;
    const raw=await request.json().catch(()=>null) as Record<string,unknown>|null;
    if(!raw||raw.confirmed!==true||!isUuid(raw.intent_id)||!isUuid(raw.bank_account_id)||typeof raw.bank_reference!=="string"||!/^([A-Z0-9-]{6,100})$/.test(raw.bank_reference)||typeof raw.amount_minor!=="number"||!Number.isSafeInteger(raw.amount_minor)||raw.amount_minor<=0||raw.amount_minor>99999999999999||typeof raw.transfer_at!=="string"||!Number.isFinite(Date.parse(raw.transfer_at))||typeof raw.statement_evidence_reference!=="string"||raw.statement_evidence_reference.trim().length<5||raw.statement_evidence_reference.trim().length>500)return fail("recycling_bank_invalid_evidence","กรอกข้อมูลจากรายการธนาคารจริงและยืนยันให้ครบ",422);
    const {data,error}=await getSupabaseServiceClient().rpc("recycling_review_bank_transfer_intent",{p_tenant_id:tenant_id,p_branch_id:branch_id,p_intent_id:raw.intent_id,p_verified_by:user_id,p_bank_account_id:raw.bank_account_id,p_bank_reference:raw.bank_reference,p_amount_minor:raw.amount_minor,p_transfer_at:raw.transfer_at,p_statement_evidence_reference:raw.statement_evidence_reference});
    if(error)return fail("recycling_bank_review_rejected","ตรวจสอบไม่ผ่าน: ตรวจสอบยอดตรงสตางค์ เลขอ้างอิงซ้ำ สิทธิ์ผู้อนุมัติ และสถานะกะ",409);
    return ok({evidence_id:data});
  }catch(e){return safeError(e);}
}
