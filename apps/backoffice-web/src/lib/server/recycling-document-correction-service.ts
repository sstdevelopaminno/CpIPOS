import "server-only";
import {fail,ok} from "@/lib/http";
import {UUID} from "@/lib/recycling-transaction-input";
import {parseRecyclingDocumentTime} from "@/lib/recycling-document-time";
import {isAuthorizedRecyclingTenant} from "@/lib/server/recycling-pos-service";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
type Actor={tenantId:string;branchId:string;userId:string;source:"pos"|"finance"};
export async function correctRecyclingDocumentTime(request:Request,id:string,actor:Actor){
 if(process.env.RECYCLING_MANUAL_DOCUMENT_TIME_ENABLED!=="1")return fail("recycling_correction_disabled","ระบบแก้ไขวันเวลาเอกสารยังไม่เปิดใช้งาน",503);
 const origin=request.headers.get("origin");
 if(origin&&origin!==new URL(request.url).origin)return fail("recycling_correction_forbidden","ไม่อนุญาตคำขอจากเว็บไซต์อื่น",403);
 if(!UUID.test(id)||!UUID.test(actor.branchId))return fail("recycling_correction_invalid","ข้อมูลเอกสารไม่ถูกต้อง",422);
 if(!await isAuthorizedRecyclingTenant(actor.tenantId))return fail("recycling_correction_forbidden","ไม่มีสิทธิ์ CUSTOM Recycling",403);
 const raw=await request.json().catch(()=>null) as Record<string,unknown>|null;
 const requestId=typeof raw?.request_id==="string"?raw.request_id:"";
 const expected=typeof raw?.expected_at==="string"?raw.expected_at:"";
 const reason=typeof raw?.reason==="string"?raw.reason.trim():"";
 const documentAt=parseRecyclingDocumentTime(raw?.document_time,new Date());
 if(!UUID.test(requestId)||!Number.isFinite(Date.parse(expected))||!documentAt||reason.length<10||reason.length>500)
  return fail("recycling_correction_invalid","กรุณาตรวจสอบวันเวลาและเหตุผล (10–500 ตัวอักษร)",422);
 const db=getSupabaseServiceClient();
 const {data,error}=await db.rpc("recycling_correct_document_time",{
  p_tenant_id:actor.tenantId,p_branch_id:actor.branchId,p_transaction_id:id,p_actor_id:actor.userId,
  p_request_id:requestId,p_expected_at:expected,p_document_at:documentAt,p_reason:reason,p_source:actor.source
 });
 if(error){
  if(error.message.includes("recycling_correction_conflict"))return fail("recycling_correction_conflict","ข้อมูลบิลเปลี่ยนแล้ว กรุณารีเฟรชก่อนแก้ไข",409);
  if(error.message.includes("recycling_correction_requires_adjustment"))return fail("recycling_correction_requires_adjustment","บิล VAT หรือบิลที่โพสต์ GL แล้วต้องใช้เอกสารปรับปรุง",409);
  if(error.message.includes("recycling_correction_forbidden"))return fail("recycling_correction_forbidden","ไม่มีสิทธิ์แก้ไขบิลในสาขานี้",403);
  return fail("recycling_correction_failed","ไม่สามารถยืนยันการแก้ไข กรุณาตรวจสอบข้อมูลก่อนส่งซ้ำ",503);
 }
 return ok(data);
}
