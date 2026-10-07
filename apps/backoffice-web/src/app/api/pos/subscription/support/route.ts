import { Buffer } from "node:buffer";
import { createHash,timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { readEnv } from "@/lib/env";
import { requirePosSessionForShiftClose } from "@/lib/pos-session-guard";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

export const runtime="nodejs";
export const dynamic="force-dynamic";

function bridgeToken(){
  const key=String(readEnv("SUPABASE_SERVICE_ROLE_KEY")??"").trim();
  return key?createHash("sha256").update("cpipos:internal-subscription-support-handoff:v1|").update(key).digest("hex"):"";
}
function reply(status:number,payload:Record<string,unknown>){return NextResponse.json(payload,{status,headers:{"cache-control":"no-store"}});}
export async function POST(req:Request){
  try{
    const scope=await requirePosSessionForShiftClose();
    const db=getPrimarySupabaseServiceClient();
    const body=await req.json().catch(()=>({})) as Record<string,unknown>;
    const dueResult=await db.rpc("subscription_billing_due_state",{p_tenant_id:scope.session.tenant_id});
    if(dueResult.error)return reply(503,{ok:false,error:"billing_state_unavailable"});
    const due=(dueResult.data??{}) as Record<string,unknown>;
    if(due.support_required!==true&&due.access_locked!==true)return reply(409,{ok:false,error:"support_not_required"});

    const since=new Date(Date.now()-12*60*60*1000).toISOString();
    const existing=await db.from("tenant_subscription_support_requests")
      .select("id,status")
      .eq("tenant_id",scope.session.tenant_id)
      .in("status",["queued","sent"])
      .gte("created_at",since)
      .order("created_at",{ascending:false}).limit(1).maybeSingle<{id:string;status:string}>();
    let requestId=existing.data?.id??null;
    if(!requestId){
      const created=await db.from("tenant_subscription_support_requests").insert({
        tenant_id:scope.session.tenant_id,
        billing_cycle_id:typeof due.billing_cycle_id==="string"?due.billing_cycle_id:null,
        payment_request_id:typeof due.open_request_id==="string"?due.open_request_id:null,
        reason_code:String(due.lock_reason??due.status??"subscription_support_required").slice(0,120),
        source:"pos_lock_popup",requested_by:scope.session.user_id,
        message:String(body.message??"POS package lock popup").slice(0,800),
        status:"queued",email_status:"queued"
      }).select("id").single<{id:string}>();
      if(created.error||!created.data)return reply(503,{ok:false,error:"support_request_create_failed"});
      requestId=created.data.id;
    }

    const base=String(readEnv("CPIPOS_IT_PRODUCTION_URL")??"https://cp-ipos-it-web.vercel.app").replace(/\/+$/,"");
    const token=bridgeToken();
    let handoff="queued";
    if(token){
      try{
        const response=await fetch(base+"/api/internal/subscription-support-handoff",{
          method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+token},
          body:JSON.stringify({
            support_request_id:requestId,tenant_id:scope.session.tenant_id,
            reason_code:String(due.lock_reason??due.status??"subscription_support_required"),
            message:String(body.message??"POS package lock popup").slice(0,800)
          }),signal:AbortSignal.timeout(8000)
        });
        handoff=response.ok?"sent":"queued";
      }catch{handoff="queued";}
    }
    return reply(200,{ok:true,support_request_id:requestId,email_handoff:handoff,chat_url:"https://lin.ee/f1LXpAF"});
  }catch(error){
    return reply(500,{ok:false,error:error instanceof Error?error.message:"support_request_failed"});
  }
}
