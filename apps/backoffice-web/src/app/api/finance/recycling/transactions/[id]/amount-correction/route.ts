import {fail} from "@/lib/http";
import {requireFinanceSession} from "@/lib/server/finance-session";
import {getTenantPosMenuOverrides} from "@/lib/server/pos-menu-policy-service";
import {isAccountantMenuVisible} from "@/lib/accountant-menu-policy";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {UUID} from "@/lib/recycling-transaction-input";
import {recyclingAmountCorrection} from "@/lib/server/recycling-amount-correction-service";
async function handle(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  if(process.env.RECYCLING_DIRECT_DATE_EDIT_ENABLED!=="1")return fail("recycling_correction_disabled","ระบบแก้ไขวันเวลาเอกสารยังไม่เปิดใช้งาน",503);
  const identity=await requireFinanceSession();
  if(!identity)return fail("finance_session_required","กรุณาเข้าสู่ระบบบัญชี",401);
  const {id}=await params;
  if(!UUID.test(id))return fail("recycling_correction_invalid","เอกสารไม่ถูกต้อง",422);
  const tx=await getSupabaseServiceClient().from("recycling_transactions").select("branch_id,direction").eq("tenant_id",identity.tenantId).in("branch_id",identity.branchIds).eq("id",id).maybeSingle();
  if(tx.error||!tx.data)return fail("recycling_correction_forbidden","ไม่มีสิทธิ์เข้าถึงเอกสารนี้",403);
  const menu=tx.data.direction==="buy"?"finance.expenses":"finance.income";
  if(!isAccountantMenuVisible(menu,await getTenantPosMenuOverrides(identity.tenantId)))return fail("recycling_correction_forbidden","ไม่มีสิทธิ์เข้าถึงทะเบียนนี้",403);
  return await recyclingAmountCorrection(request,id,{tenantId:identity.tenantId,branchId:tx.data.branch_id,userId:identity.userId,source:"finance"});
 }catch{return fail("recycling_correction_failed","ไม่สามารถแก้ไขเอกสารได้",503);}
}

export const GET=handle;
export const POST=handle;
