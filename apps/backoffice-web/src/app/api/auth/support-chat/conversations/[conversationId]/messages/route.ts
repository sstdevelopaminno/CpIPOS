import {ok,fail} from "@/lib/http";
import {issuePreEntryBridge} from "@/lib/server/preentry-support";
import {callSupportChat,mirrorSupportChatHead,type SupportChatHead} from "@/lib/services/support-chat/support-chat-bridge";
import {dispatchSupportPush} from "@/lib/services/support-chat/support-push";
import {enforceRateLimit,getClientIpAddress} from "@/lib/server/rate-limit";
export const dynamic="force-dynamic";
type Params={params:Promise<{conversationId:string}>};
export async function GET(_request:Request,{params}:Params){
 try{
  const {token}=await issuePreEntryBridge(),{conversationId}=await params;
  const data=await callSupportChat<{
   conversation:Record<string,unknown>;messages:Array<Record<string,unknown>>;head:SupportChatHead;head_changed?:boolean
  }>(token,"get_messages",{conversation_id:conversationId,mark_read:true});
  if(data.head_changed)await mirrorSupportChatHead(data.head).catch(()=>null);
  return ok({conversation:data.conversation,messages:data.messages});
 }catch{return fail("support_unavailable","ไม่สามารถโหลดข้อความได้",503);}
}
export async function POST(request:Request,{params}:Params){
 try{
  const {identity,token}=await issuePreEntryBridge(),{conversationId}=await params;
  const origin=request.headers.get("origin");
  if(origin&&origin!==new URL(request.url).origin)return fail("origin_invalid","Invalid origin",403);
  const limit=await enforceRateLimit({namespace:"preentry_support_message",
    key:identity.tenantId+":"+getClientIpAddress(request),max:25,windowMs:300000,failClosedOnBackendError:true});
  if(!limit.ok)return fail("rate_limited","ส่งข้อความถี่เกินไป",429);
  const body=await request.json().catch(()=>null) as {message?:string;attachment?:{name:string;mime_type:string;size_bytes:number;data_base64:string}}|null;
  const message=String(body?.message||"").trim().slice(0,4000);
  if(!message&&!body?.attachment)return fail("message_required","พิมพ์ข้อความหรือแนบไฟล์",422);
  const data=await callSupportChat<{conversation:Record<string,unknown>;message:Record<string,unknown>;head:SupportChatHead}>(
    token,"send_message",{conversation_id:conversationId,message,attachment:body?.attachment||null});
  await Promise.allSettled([
    mirrorSupportChatHead(data.head),
    dispatchSupportPush({audience:"it",kind:"chat",title:"แชทจากร้านค้า · "+identity.storeName,
     body:message||"มีรูปภาพ",url:"/it-admin/support-chat",tag:"support-chat:"+conversationId})
  ]);
  return ok(data);
 }catch{return fail("support_unavailable","ไม่สามารถส่งข้อความได้",503);}
}
