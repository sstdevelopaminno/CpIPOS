import {NextResponse} from "next/server";
import {requirePermission,requirePosSession,PosGuardError} from "@/lib/pos-session-guard";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {DEFAULT_BRANDING,loadTenantBranding,normalizeCustomBranding,requireCustomBrandingTenant} from "@/lib/server/custom-branding";

function out(code:string,message:string,status:number){
 return NextResponse.json({data:null,error:{code,message}},{status});
}
export async function GET(){
 try{
  const scope=await requirePosSession();
  requirePermission(scope,"settings:view");
  const branding=await loadTenantBranding(scope.session.tenant_id);
  return NextResponse.json({data:{enabled:branding!==null,branding:branding??DEFAULT_BRANDING},error:null});
 }catch(e){
  if(e instanceof PosGuardError)return out(e.code,e.message,e.status);
  return out("custom_branding_unavailable","ไม่สามารถโหลดธีมของร้านได้",503);
 }
}
export async function PATCH(request:Request){
 try{
  const scope=await requirePosSession();
  requirePermission(scope,"settings:view");
  const role=String(scope.session.role??"").toLowerCase();
  if(!["owner","manager"].includes(role))return out("custom_branding_role_forbidden","เฉพาะเจ้าของร้านหรือผู้จัดการ",403);
  if(!await requireCustomBrandingTenant(scope.session.tenant_id))
   return out("custom_branding_custom_only","ใช้ได้เฉพาะแพ็กเกจ CUSTOM ที่เปิดใช้งาน",403);
  const body=await request.json().catch(()=>null);
  if(!body||typeof body!=="object")return out("invalid_branding","ข้อมูลไม่ถูกต้อง",422);
  const d=body as Record<string,unknown>;
  const name=typeof d.system_name==="string"?d.system_name.trim():"";
  if(name.length<2||name.length>55||/[<>]/.test(name) ||
    typeof d.accent_color!=="string"|| !/^#[0-9a-fA-F]{6}$/.test(d.accent_color)||
    typeof d.sidebar_color!=="string"|| !/^#[0-9a-fA-F]{6}$/.test(d.sidebar_color))
    return out("invalid_branding","กรุณาตรวจสอบชื่อระบบและรหัสสี 6 หลัก",422);
  const branding=normalizeCustomBranding(d);
  const tenant=scope.session.tenant_id;
  if(d.logo_url!==null&&d.logo_url!==undefined&&d.logo_url!==""){
    const db=getSupabaseServiceClient();
    const publicBase=db.storage.from("custom-branding").getPublicUrl(tenant+"/").data.publicUrl;
    if(!branding.logo_url||!branding.logo_url.startsWith(publicBase) ||
      !/^[-\w]+\.(png|jpg|webp)$/i.test(branding.logo_url.substring(publicBase.length)))
      return out("invalid_branding_logo","ต้องใช้โลโก้ที่อัปโหลดสำหรับร้านนี้เท่านั้น",422);
  }
  const {error}=await getSupabaseServiceClient().rpc("cpipos_service_save_custom_branding_v1",{
   p_tenant_id:tenant,p_branding:branding
  });
  if(error)throw error;
  return NextResponse.json({data:{branding},error:null});
 }catch(e){
  if(e instanceof PosGuardError)return out(e.code,e.message,e.status);
  console.error("[custom-branding] save failed",e);
  return out("custom_branding_save_failed","บันทึกไม่สำเร็จ กรุณาตรวจสอบการติดตั้งสิทธิ์ฐานข้อมูล",503);
 }
}