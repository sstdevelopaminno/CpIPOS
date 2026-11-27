import {fail,ok} from "@/lib/http";
import {PosGuardError,requirePosSession,requirePermission} from "@/lib/pos-session-guard";
import {isAuthorizedRecyclingTenant} from "@/lib/server/recycling-pos-service";
import {canManageRecyclingCashierDate,readRecyclingCashierDate,saveRecyclingCashierDate} from "@/lib/server/recycling-cashier-date-service";
export const dynamic="force-dynamic";
async function authorize(){
 const scope=await requirePosSession();requirePermission(scope,"settings:view");
 const s=scope.session;
 if(!["owner","manager"].includes(s.role)||!await isAuthorizedRecyclingTenant(s.tenant_id)||!await canManageRecyclingCashierDate(s.tenant_id,s.branch_id,s.user_id))throw new PosGuardError("recycling_cashier_date_forbidden","เฉพาะเจ้าของหรือผู้จัดการ CUSTOM Recycling",403);
 return s;
}
function error(e:unknown){if(e instanceof PosGuardError)return fail(e.code,e.message,e.status);
 if(e instanceof Error&&e.message==="recycling_cashier_date_not_ready")return fail(e.message,"ระบบเปลี่ยนวันเวลายังไม่พร้อมเปิดใช้งาน",409);
 return fail("recycling_cashier_date_failed","ไม่สามารถบันทึกการตั้งค่า กรุณาโหลดใหม่",503);}
export async function GET(){try{const s=await authorize();const response=ok(await readRecyclingCashierDate(s.tenant_id,s.branch_id));response.headers.set("cache-control","private, no-store");return response;}catch(e){return error(e);}}
export async function PATCH(request:Request){try{const s=await authorize();if(request.headers.get("origin")!==new URL(request.url).origin||!request.headers.get("content-type")?.startsWith("application/json"))return fail("invalid_origin","คำขอไม่ถูกต้อง",403);
 const body=await request.json().catch(()=>null);if(typeof body?.enabled!=="boolean")return fail("invalid_setting","ข้อมูลไม่ถูกต้อง",422);
 return ok(await saveRecyclingCashierDate(s.tenant_id,s.branch_id,s.user_id,body.enabled));}catch(e){return error(e);}}
