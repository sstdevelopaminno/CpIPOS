import {ok,fail} from "@/lib/http";
import {issuePreEntryBridge} from "@/lib/server/preentry-support";
import {callSupportChat,mirrorSupportChatHead,type SupportChatHead} from "@/lib/services/support-chat/support-chat-bridge";
export const dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{conversationId:string}>}){
 try{
  const {token}=await issuePreEntryBridge(),{conversationId}=await params;
  const origin=request.headers.get("origin");
  if(origin&&origin!==new URL(request.url).origin)return fail("origin_invalid","Invalid origin",403);
  const body=await request.json().catch(()=>null) as {action?:string}|null;
  if(body?.action!=="close")return fail("action_invalid","Invalid action",422);
  const data=await callSupportChat<{conversation:Record<string,unknown>;head:SupportChatHead}>(token,"close_conversation",{conversation_id:conversationId});
  await mirrorSupportChatHead(data.head);
  return ok(data);
 }catch{return fail("support_unavailable","ไม่สามารถปิดแชทได้",503);}
}
