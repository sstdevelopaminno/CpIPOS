import {ok,fail} from "@/lib/http";
import {getPrimarySupabaseServiceClient} from "@/lib/supabase-admin";
import {requirePreEntrySupport,issuePreEntryBridge} from "@/lib/server/preentry-support";
import {loadPosSupportChatHeads,callSupportChat,mirrorSupportChatHead,type SupportChatHead} from "@/lib/services/support-chat/support-chat-bridge";
import {enforceRateLimit,getClientIpAddress} from "@/lib/server/rate-limit";
export const dynamic="force-dynamic";
export async function GET(){
 try{
  const scope=await requirePreEntrySupport();
  const res=ok({conversations:await loadPosSupportChatHeads(scope.tenantId)});
  res.headers.set("Cache-Control","private, no-store");return res;
 }catch{return fail("support_unavailable","กรุณายืนยันตัวตนพนักงานก่อนเปิดแชท",401);}
}
export async function POST(request:Request){
 try{
  const {identity,token}=await issuePreEntryBridge();
  const origin=request.headers.get("origin");
  if(origin&&origin!==new URL(request.url).origin)return fail("origin_invalid","Invalid origin",403);
  const limit=await enforceRateLimit({namespace:"preentry_support_create",
    key:identity.tenantId+":"+getClientIpAddress(request),max:5,windowMs:600000,failClosedOnBackendError:true});
  if(!limit.ok)return fail("rate_limited","กรุณารอสักครู่",429);
  const body=await request.json().catch(()=>null) as {subject?:string;contact_name?:string}|null;
  const subject=String(body?.subject||"").trim().slice(0,180);
  const contactName=String(body?.contact_name||"").trim().slice(0,120);
  if(subject.length<2||contactName.length<2)return fail("missing_fields","กรุณาระบุเรื่องและผู้ติดต่อ",422);
  const db=getPrimarySupabaseServiceClient();
  const tenant=await db.from("tenants").select("logo_url").eq("id",identity.tenantId).maybeSingle();
  if(tenant.error)return fail("store_unavailable","ไม่พบร้านค้า",503);
  const data=await callSupportChat<{conversation:Record<string,unknown>;head:SupportChatHead;already_open:boolean}>(
    token,"create_conversation",{subject,contact_name:contactName,store_code:identity.storeCode,
    store_name:identity.storeName,store_logo_url:tenant.data?.logo_url||null});
  await mirrorSupportChatHead(data.head);
  return ok(data);
 }catch{return fail("support_unavailable","เปิดแชทกับ IT ไม่สำเร็จ",503);}
}
