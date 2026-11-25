import {fail,ok} from "@/lib/http";
import {requirePosSession,PosGuardError} from "@/lib/pos-session-guard";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {isAuthorizedRecyclingTenant} from "@/lib/server/recycling-pos-service";

export async function POST(request:Request){
 if(process.env.RECYCLING_BANK_TRANSFERS_ENABLED!=="1")return fail("recycling_bank_not_ready","ระบบตรวจสอบเงินโอนยังไม่พร้อม",503);
 try{
  const scope=await requirePosSession();
  if(scope.session.role!=="accountant"||!await isAuthorizedRecyclingTenant(scope.session.tenant_id))return fail("accountant_only","เฉพาะฝ่ายบัญชีของร้าน",403);
  const {tenant_id,branch_id,user_id}=scope.session;
  const raw=await request.json().catch(()=>null) as Record<string,unknown>|null;
  if(!raw||raw.confirmed!==true)return fail("confirmation_required","ต้องยืนยันหลักฐานบัญชีจริง",422);
  const read=(key:string)=>typeof raw[key]==="string"?(raw[key] as string).trim():"";
  const bank_code=read("bank_code").toUpperCase(),account_last4=read("account_last4"),account_label=read("account_label"),evidence_reference=read("evidence_reference");
  if(!/^[A-Z0-9]{2,12}$/.test(bank_code)||!/^\d{4}$/.test(account_last4)||account_label.length<2||account_label.length>120||evidence_reference.length<5||evidence_reference.length>500)return fail("invalid_bank_account","กรอกข้อมูลบัญชีตามหลักฐานจริงให้ครบ",422);
  const db=getSupabaseServiceClient();
  const chart=await db.from("finance_accounting_chart").select("account_type").eq("tenant_id",tenant_id).eq("account_code","1110").maybeSingle();
  if(chart.error||chart.data?.account_type!=="asset")return fail("bank_chart_missing","ต้องเตรียมบัญชี 1110 ประเภทสินทรัพย์ก่อน",409);
  const result=await db.rpc("recycling_register_verified_bank_account",{p_tenant_id:tenant_id,p_branch_id:branch_id,p_verified_by:user_id,p_bank_code:bank_code,p_account_last4:account_last4,p_account_label:account_label,p_evidence_reference:evidence_reference});
  if(result.error)return fail("bank_account_registration_failed","ยังไม่ยืนยันผลการบันทึก กรุณาตรวจสอบรายการเดิมก่อนส่งซ้ำ",409);
  return ok({id:result.data});
 }catch(error){if(error instanceof PosGuardError)return fail(error.code,error.message,error.status);return fail("bank_account_registration_failed","ไม่สามารถยืนยันการบันทึกบัญชีธนาคาร",503);}
}
