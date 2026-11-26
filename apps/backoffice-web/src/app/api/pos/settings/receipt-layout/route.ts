import {fail,ok} from "@/lib/http";
import {PosGuardError,requirePosSession,requirePermission} from "@/lib/pos-session-guard";
import {requireCustomBrandingTenant} from "@/lib/server/custom-branding";
import {getTenantPosMenuOverrides} from "@/lib/server/pos-menu-policy-service";
import {isCustomPosMenuVisible} from "@/lib/pos-menu-policy";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {readReceiptLayoutMetadata,saveReceiptLayout} from "@/lib/server/custom-receipt-layout-service";
import {normalizeReceiptVisibility,receiptVisibilityFromMetadata,validReceiptVisibility} from "@/lib/printing/custom-receipt-layout";
async function authorize(){
 const scope=await requirePosSession();requirePermission(scope,"settings:view");
 const s=scope.session;
 if(!["owner","manager"].includes(s.role)||!await requireCustomBrandingTenant(s.tenant_id)||!isCustomPosMenuVisible("settings.printers",await getTenantPosMenuOverrides(s.tenant_id),true))throw new PosGuardError("receipt_layout_forbidden","ไม่มีสิทธิ์ตั้งค่ารูปแบบใบเสร็จ",403);
 const db=getSupabaseServiceClient();
 const [branch,role]=await Promise.all([db.from("branches").select("id,name").eq("id",s.branch_id).eq("tenant_id",s.tenant_id).eq("is_active",true).maybeSingle(),db.from("user_branch_roles").select("role").eq("tenant_id",s.tenant_id).eq("branch_id",s.branch_id).eq("user_id",s.user_id).maybeSingle()]);
 if(branch.error||role.error||!branch.data||!["owner","manager"].includes(String(role.data?.role)))throw new PosGuardError("receipt_layout_forbidden","ไม่มีสิทธิ์จัดการสาขานี้",403);
 return {s,branch:branch.data};
}
function failure(e:unknown){if(e instanceof PosGuardError)return fail(e.code,e.message,e.status);if(e instanceof Error&&e.message==="receipt_layout_conflict")return fail("receipt_layout_conflict","มีการเปลี่ยนการตั้งค่าพร้อมกัน กรุณาโหลดใหม่",409);return fail("receipt_layout_failed","ไม่สามารถบันทึกหรือโหลดการตั้งค่าได้",503);}
export async function GET(){
 try{const {s,branch}=await authorize();const metadata=await readReceiptLayoutMetadata(s.tenant_id);
 const res=ok({branch_name:branch.name,layouts:{recycling:normalizeReceiptVisibility(receiptVisibilityFromMetadata(metadata,s.branch_id,"recycling")),shared:normalizeReceiptVisibility(receiptVisibilityFromMetadata(metadata,s.branch_id,"shared"))}});
 res.headers.set("Cache-Control","private, no-store");return res;}catch(e){return failure(e);}
}
export async function PATCH(request:Request){
 try{const {s}=await authorize();const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin)return fail("receipt_layout_origin","ไม่อนุญาตคำขอจากเว็บไซต์อื่น",403);
 const body=await request.json().catch(()=>null);
 if(!body||(body.mode!=="recycling"&&body.mode!=="shared")||!validReceiptVisibility(body.fields))return fail("receipt_layout_invalid","รูปแบบการตั้งค่าไม่ถูกต้อง",422);
 return ok({fields:await saveReceiptLayout(s.tenant_id,s.branch_id,s.user_id,body.mode,normalizeReceiptVisibility(body.fields))});}catch(e){return failure(e);}
}
