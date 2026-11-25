import { fail,ok } from "@/lib/http";
import { requirePosSession,PosGuardError } from "@/lib/pos-session-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { parseVatRegistration } from "@/lib/recycling-vat-registration-input";
import { appendAuditLog } from "@/lib/audit-log";

export const dynamic="force-dynamic";
const todayBangkok=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
async function scopeForVat(){
  const scope=await requirePosSession();
  if(!["owner","accountant"].includes(scope.session.role)||!await isAuthorizedRecyclingTenant(scope.session.tenant_id))return null;
  return scope;
}
export async function GET(){
  try{
    const scope=await scopeForVat();
    if(!scope)return fail("forbidden_role","เฉพาะเจ้าของร้านและฝ่ายบัญชี",403);
    const {tenant_id,branch_id}=scope.session;
    const db=getSupabaseServiceClient();
    const [issuer,chart,tax]=await Promise.all([
      db.from("recycling_vat_issuers").select("active,verified_at,verified_from,verified_until").eq("tenant_id",tenant_id).eq("branch_id",branch_id).maybeSingle(),
      db.from("finance_accounting_chart").select("account_code,account_name,account_type").eq("tenant_id",tenant_id).eq("account_code","2200").maybeSingle(),
      db.from("tenant_tax_settings").select("is_enabled").eq("tenant_id",tenant_id).eq("branch_id",branch_id).maybeSingle()
    ]);
    if(issuer.error||chart.error||tax.error)return fail("vat_setup_unavailable","ไม่สามารถตรวจสอบข้อมูลภาษีได้",503);
    const today=todayBangkok();
    const i=issuer.data;
    return ok({configured:tax.data?.is_enabled===true,verified:Boolean(i?.active&&i.verified_at&&i.verified_from<=today&&(!i.verified_until||i.verified_until>=today)),chart:chart.data??null,can_edit:scope.session.role==="accountant"});
  }catch(error){if(error instanceof PosGuardError)return fail(error.code,error.message,error.status);
    return fail("vat_setup_unavailable","ไม่สามารถตรวจสอบข้อมูลภาษีได้",503);}
}
export async function POST(request:Request){
  try{
    const scope=await scopeForVat();
    if(!scope||scope.session.role!=="accountant")return fail("accountant_only","เฉพาะฝ่ายบัญชีของสาขาเท่านั้น",403);
    const {tenant_id,branch_id,user_id}=scope.session;
    const raw=await request.json().catch(()=>null) as Record<string,unknown>|null;
    const db=getSupabaseServiceClient();
    if(raw?.action==="prepare_chart"){
      if(raw.confirmed!==true)return fail("confirmation_required","กรุณายืนยันการจัดเตรียมผังบัญชี",422);
      const existing=await db.from("finance_accounting_chart").select("id,account_type").eq("tenant_id",tenant_id).eq("account_code","2200").maybeSingle();
      if(existing.error)return fail("vat_chart_unavailable","ตรวจสอบผังบัญชีไม่ได้",503);
      if(existing.data){
        if(existing.data.account_type!=="liability")return fail("vat_chart_conflict","บัญชี 2200 มีประเภทอื่นอยู่แล้ว กรุณาตรวจสอบผังบัญชี ห้ามเขียนทับ",409);
        return ok({ready:true});
      }
      const inserted=await db.from("finance_accounting_chart").upsert({tenant_id,account_code:"2200",account_name:"ภาษีขายรอนำส่ง",account_type:"liability",created_by:user_id},{onConflict:"tenant_id,account_code",ignoreDuplicates:true});
      if(inserted.error)return fail("vat_chart_write_failed","จัดเตรียมผังบัญชีไม่สำเร็จ",503);
      const check=await db.from("finance_accounting_chart").select("id,account_type").eq("tenant_id",tenant_id).eq("account_code","2200").maybeSingle();
      if(check.error||check.data?.account_type!=="liability")return fail("vat_chart_conflict","ยังยืนยันผังบัญชีไม่ได้ กรุณาตรวจสอบอีกครั้ง",409);
      await appendAuditLog({tenantId:tenant_id,branchId:branch_id,actorUserId:user_id,actorRole:"accountant",action:"recycling_vat_chart_prepared",targetTable:"finance_accounting_chart",targetId:check.data.id,metadata:{account_code:"2200"}});
      return ok({ready:true});
    }
    if(raw?.action!=="verify_registration")return fail("invalid_action","ไม่รองรับคำสั่งนี้",422);
    const parsed=parseVatRegistration(raw,todayBangkok());
    if(!parsed)return fail("invalid_vat_registration","กรุณากรอกข้อมูลตามหลักฐาน VAT จริง วันที่มีผลถูกต้อง และยืนยันการตรวจสอบ",422);
    const tax=await db.from("tenant_tax_settings").select("is_enabled").eq("tenant_id",tenant_id).eq("branch_id",branch_id).maybeSingle();
    if(tax.error||tax.data?.is_enabled!==true)return fail("vat_not_configured","กรุณาตรวจสอบการตั้งค่า VAT ของสาขาก่อน",409);
    const result=await db.from("recycling_vat_issuers").upsert({...parsed,tenant_id,branch_id,verified_by:user_id,verified_at:new Date().toISOString(),active:true,updated_at:new Date().toISOString()},{onConflict:"tenant_id,branch_id"});
    if(result.error)return fail("vat_registration_write_failed","บันทึกการยืนยันทะเบียนไม่สำเร็จ",503);
    await appendAuditLog({tenantId:tenant_id,branchId:branch_id,actorUserId:user_id,actorRole:"accountant",action:"recycling_vat_registration_attested",targetTable:"recycling_vat_issuers",metadata:{verified_from:parsed.verified_from,verified_until:parsed.verified_until}});
    return ok({verified:true});
  }catch(error){if(error instanceof PosGuardError)return fail(error.code,error.message,error.status);
    return fail("vat_setup_failed","ไม่สามารถยืนยันผลการบันทึกได้ กรุณาตรวจสอบสถานะก่อนทำซ้ำ",503);}
}
