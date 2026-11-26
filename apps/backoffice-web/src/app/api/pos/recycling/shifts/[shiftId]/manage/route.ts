import {fail,ok} from "@/lib/http";
import {requirePosSession,requirePermission,PosGuardError} from "@/lib/pos-session-guard";
import {isAuthorizedRecyclingTenant} from "@/lib/server/recycling-pos-service";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
export const dynamic="force-dynamic";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const date=(v:unknown)=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const money=(v:unknown)=>typeof v==="string"&&/^\d{1,12}(\.\d{1,2})?$/.test(v)&&Number(v)<=999999999999.99;
export async function POST(request:Request,context:{params:Promise<{shiftId:string}>}){
 try{
  const scope=await requirePosSession();
  requirePermission(scope,"shift:open");requirePermission(scope,"shift:close");
  if(!["owner","manager"].includes(scope.session.role)||!await isAuthorizedRecyclingTenant(scope.session.tenant_id))return fail("shift_history_forbidden","เฉพาะเจ้าของร้านหรือผู้จัดการที่ได้รับสิทธิ์",403);
  const {shiftId}=await context.params;
  const raw=await request.json().catch(()=>null) as Record<string,unknown>|null;
  if(!uuid.test(shiftId)||!raw||!["edit","delete"].includes(String(raw.action))||raw.confirmed!==true||typeof raw.reason!=="string"||raw.reason.trim().length<5||raw.reason.trim().length>500||!date(raw.version))return fail("shift_history_invalid","กรุณายืนยันและระบุเหตุผล 5–500 ตัวอักษร",422);
  if(raw.action==="edit"&&(!date(raw.opened_at)||!date(raw.closed_at)||!money(raw.opening_cash)||!money(raw.actual_cash)))return fail("shift_history_invalid","กรอกวันเวลาและยอดเงินที่ถูกต้อง",422);
  const {data,error}=await getSupabaseServiceClient().rpc("recycling_manage_closed_shift_v1",{
   p_session_id:scope.session.id,p_shift_id:shiftId,p_action:raw.action,p_version:raw.version,p_reason:raw.reason.trim(),
   p_opened_at:raw.action==="edit"?raw.opened_at:null,p_closed_at:raw.action==="edit"?raw.closed_at:null,
   p_opening_cash:raw.action==="edit"?raw.opening_cash:null,p_actual_cash:raw.action==="edit"?raw.actual_cash:null
  });
  if(error){
   const messages:Record<string,string>={shift_history_conflict:"ข้อมูลกะเปลี่ยนแล้ว กรุณารีเฟรช",shift_history_later:"มีกะถัดไปแล้ว ต้องให้ฝ่ายบัญชีตรวจสอบยอดยกมาก่อน",shift_history_dependencies:"มีธุรกรรมหรือข้อมูลเชื่อมโยง ไม่สามารถลบหรือแก้ไขวันเวลา/ทุนได้",shift_history_print_pending:"มีคิวพิมพ์ที่ยังไม่เสร็จ กรุณาตรวจสอบคิวก่อน",shift_history_invalid:"วันเวลา หรือยอดเงินไม่ถูกต้อง",shift_history_forbidden:"ไม่มีสิทธิ์จัดการกะนี้"};
   const code=Object.keys(messages).find(k=>error.message.includes(k));
   return fail(code??"shift_history_failed",code?messages[code]:"ไม่สามารถยืนยันผลการจัดการกะได้ กรุณาตรวจสอบรายการก่อนทำซ้ำ",409);
  }
  return ok(data);
 }catch(e){if(e instanceof PosGuardError)return fail(e.code,e.message,e.status);return fail("shift_history_failed","ไม่สามารถยืนยันผลได้ กรุณารีเฟรช",503);}
}
