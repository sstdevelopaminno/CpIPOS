import {randomUUID} from "node:crypto";
import {NextResponse} from "next/server";
import {requirePermission,requirePosSession,PosGuardError} from "@/lib/pos-session-guard";
import {getPrimarySupabaseServiceClient} from "@/lib/supabase-admin";
import {requireCustomBrandingTenant} from "@/lib/server/custom-branding";

const MAX_BYTES=1048576;
const signature=(b:Buffer)=>{
 if(b.length>8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {mime:"image/png",ext:"png"};
 if(b.length>3&&b[0]===255&&b[1]===216&&b[2]===255)return {mime:"image/jpeg",ext:"jpg"};
 if(b.length>12&&b.toString("ascii",0,4)==="RIFF"&&b.toString("ascii",8,12)==="WEBP")return {mime:"image/webp",ext:"webp"};
 return null;
};
const fail=(message:string,status:number)=>NextResponse.json({data:null,error:{message}},{status});
export async function POST(request:Request){
 try{
  const scope=await requirePosSession();
  requirePermission(scope,"settings:view");
  if(!["owner","manager"].includes(String(scope.session.role??"").toLowerCase()) ||
     !await requireCustomBrandingTenant(scope.session.tenant_id))return fail("เฉพาะเจ้าของร้านหรือผู้จัดการ CUSTOM",403);
  const size=Number(request.headers.get("content-length")||0);
  if(size>MAX_BYTES+4096)return fail("โลโก้ต้องไม่เกิน 1 MB",413);
  const form=await request.formData();
  const file=form.get("logo");
  if(!(file instanceof File)||file.size===0||file.size>MAX_BYTES)return fail("กรุณาเลือกรูปไม่เกิน 1 MB",422);
  const buffer=Buffer.from(await file.arrayBuffer());
  const type=signature(buffer);
  if(!type||file.type!==type.mime)return fail("รองรับ JPG PNG WebP ที่ถูกต้องเท่านั้น",415);
  const tenantId=scope.session.tenant_id;
  const path=tenantId+"/"+randomUUID()+"."+type.ext;
  const db=getPrimarySupabaseServiceClient();
  const {error}=await db.storage.from("custom-branding").upload(path,buffer,{
   contentType:type.mime,cacheControl:"31536000",upsert:false
  });
  if(error)throw error;
  const logoUrl=db.storage.from("custom-branding").getPublicUrl(path).data.publicUrl;
  return NextResponse.json({data:{logo_url:logoUrl},error:null});
 }catch(e){
  if(e instanceof PosGuardError)return fail(e.message,e.status);
  console.error("[custom-branding] logo failed",e);
  return fail("อัปโหลดโลโก้ไม่สำเร็จ กรุณาตรวจสอบ Storage",503);
 }
}