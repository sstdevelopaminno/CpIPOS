import "server-only";
import {fail,ok} from "@/lib/http";
import {UUID,readLine} from "@/lib/recycling-transaction-input";
import {isAuthorizedRecyclingTenant} from "@/lib/server/recycling-pos-service";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
type Actor={tenantId:string;branchId:string;userId:string;source:"pos"|"finance"};
export async function recyclingAmountCorrection(request:Request,id:string,actor:Actor){
 if(process.env.RECYCLING_DIRECT_DATE_EDIT_ENABLED!=="1"||process.env.RECYCLING_AMOUNT_CORRECTION_ENABLED!=="1")return fail("recycling_amount_disabled","ระบบแก้ไขยอดยังไม่เปิดใช้งาน",503);
 const origin=request.headers.get("origin");
 if(origin&&origin!==new URL(request.url).origin)return fail("recycling_amount_forbidden","ไม่อนุญาตคำขอจากเว็บไซต์อื่น",403);
 if(!UUID.test(id)||!UUID.test(actor.branchId)||!await isAuthorizedRecyclingTenant(actor.tenantId))return fail("recycling_amount_forbidden","ไม่มีสิทธิ์เข้าถึงเอกสาร",403);
 const db=getSupabaseServiceClient();
 if(request.method==="GET"){
  const [tx,lines]=await Promise.all([
   db.from("recycling_transactions").select("id,receipt_no,effective_document_at,total_minor,status,settlement,finance_document_id,tax_state").eq("tenant_id",actor.tenantId).eq("branch_id",actor.branchId).eq("id",id).maybeSingle(),
   db.from("recycling_transaction_lines").select("id,product_id,name_snapshot,original_unit,original_quantity,price_per_base").eq("tenant_id",actor.tenantId).eq("branch_id",actor.branchId).eq("transaction_id",id).order("line_no")
  ]);
  if(tx.error||lines.error||!tx.data||!lines.data?.length)return fail("recycling_amount_unavailable","ไม่พบข้อมูลบิล",404);
  if(tx.data.status!=="posted"||tx.data.finance_document_id||tx.data.settlement==="bank_transfer")return fail("recycling_amount_requires_adjustment","เอกสารนี้ต้องใช้ขั้นตอนปรับปรุงบัญชีเฉพาะ",409);
  const response=ok({transaction:tx.data,lines:lines.data});response.headers.set("Cache-Control","private, no-store");return response;
 }
 const raw=await request.json().catch(()=>null) as Record<string,unknown>|null;
 const requestId=typeof raw?.request_id==="string"?raw.request_id:"";
 const expected=typeof raw?.expected_at==="string"?raw.expected_at:"";
 const total=raw?.expected_total;
 const reason=typeof raw?.reason==="string"?raw.reason.trim():"";
 if(!UUID.test(requestId)||!Number.isFinite(Date.parse(expected))||typeof total!=="number"||!Number.isSafeInteger(total)||total<=0||reason.length<10||reason.length>500||raw?.stock_verified!==true||!Array.isArray(raw?.lines)||raw.lines.length<1||raw.lines.length>100)return fail("recycling_amount_invalid","กรุณาตรวจสอบจำนวน เหตุผล และการยืนยันสต๊อก",422);
 const lines=raw.lines.map(readLine);if(lines.some(x=>x===null))return fail("recycling_amount_invalid","รายการวัสดุไม่ถูกต้อง",422);
 const {data,error}=await db.rpc("recycling_replace_eligible_bill",{p_tenant_id:actor.tenantId,p_branch_id:actor.branchId,p_original_id:id,p_actor_id:actor.userId,p_request_id:requestId,p_expected_at:expected,p_expected_total:total,p_lines:lines,p_reason:reason,p_source:actor.source,p_stock_verified:true,p_cash_verified:raw.cash_verified===true});
 if(error){
  const messages:Record<string,string>={recycling_amount_correction_conflict:"ข้อมูลบิลเปลี่ยนแล้ว กรุณาตรวจสอบก่อนส่งซ้ำ",recycling_amount_correction_gl_reversal_required:"บิลที่ลง GL แล้วต้องใช้ขั้นตอนกลับบัญชี",recycling_amount_correction_tax_note_required:"บิลที่ออกใบกำกับภาษีแล้วต้องใช้ใบลดหนี้/เพิ่มหนี้",recycling_void_material_has_later_movement:"วัสดุมีการเคลื่อนไหวภายหลัง ต้องปรับต้นทุนย้อนหลัง",recycling_amount_correction_closed_shift:"กะปิดแล้ว ต้องใช้ขั้นตอนปรับปรุงเฉพาะ",recycling_price_changed_refresh_cart:"ราคาวัสดุในระบบเปลี่ยนแล้ว",recycling_amount_correction_period_locked:"งวดบัญชีปิดแล้ว",recycling_amount_correction_cash_unverified:"กรุณายืนยันส่วนต่างเงินสด",recycling_amount_correction_tax_regime_changed:"ข้อมูลภาษีไม่ตรงกับบิลเดิม"};
  const code=Object.keys(messages).find(k=>error.message.includes(k));if(code)return fail(code,messages[code],409);
  if(error.message.includes("forbidden"))return fail("recycling_amount_forbidden","ไม่มีสิทธิ์แก้ไขบิล",403);
  return fail("recycling_amount_failed","ไม่สามารถยืนยันการแก้ไข กรุณาตรวจสอบก่อนส่งซ้ำ",503);
 }
 return ok(data);
}
