import { createHash } from "node:crypto";
import { readEnv } from "@/lib/env";
import { fail, ok } from "@/lib/http";
import { requirePosSessionForSubscriptionAccess } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export const runtime="nodejs";
export const dynamic="force-dynamic";

function bridgeToken(){
  const serviceRole=String(readEnv("SUPABASE_SERVICE_ROLE_KEY")??"").trim();
  if(!serviceRole)return"";
  return createHash("sha256")
    .update("cpipos:internal-subscription-support-handoff:v1|")
    .update(serviceRole)
    .digest("hex");
}

export async function POST(req:Request){
  try{
    const scope=await requirePosSessionForSubscriptionAccess();
    const body=await req.json().catch(()=>null) as {message?:unknown}|null;
    const message=String(body?.message??"").trim().slice(0,800);
    const db=getSupabaseServiceClient();
    const dueResult=await db.rpc("subscription_billing_due_state",{p_tenant_id:scope.session.tenant_id});
    if(dueResult.error)return fail("billing_state_unavailable","Unable to load package status.",503);
    const due=(dueResult.data??{}) as Record<string,unknown>;
    const inserted=await db.from("tenant_subscription_support_requests").insert({
      tenant_id:scope.session.tenant_id,
      billing_cycle_id:typeof due.billing_cycle_id==="string"?due.billing_cycle_id:null,
      payment_request_id:typeof due.open_request_id==="string"?due.open_request_id:null,
      reason_code:String(due.lock_reason??(due.support_required===true?"subscription_payment_support_required":"customer_requested_support")),
      source:"pos",
      requested_by:scope.session.user_id,
      message:message||null,
      status:"queued"
    }).select("id").single<{id:string}>();
    if(inserted.error||!inserted.data)return fail("support_request_create_failed","Unable to create Support request.",503);

    const baseUrl=String(readEnv("CPIPOS_IT_PRODUCTION_URL")??"https://cp-ipos-it-web.vercel.app").replace(/\/$/,"");
    const token=bridgeToken();
    let handoffStatus="queued";
    if(token){
      try{
        const response=await fetch(baseUrl+"/api/internal/subscription-support-handoff",{
          method:"POST",
          headers:{authorization:"Bearer "+token,"content-type":"application/json"},
          body:JSON.stringify({
            support_request_id:inserted.data.id,
            tenant_id:scope.session.tenant_id,
            reason_code:String(due.lock_reason??"subscription_support_required"),
            message
          }),
          cache:"no-store",
          signal:AbortSignal.timeout(10000)
        });
        handoffStatus=response.ok?"sent":"queued";
      }catch{
        handoffStatus="queued";
      }
    }
    return ok({support_request_id:inserted.data.id,handoff_status:handoffStatus});
  }catch(error){
    return fail("support_request_failed",error instanceof Error?error.message:"Unable to contact Support.",400);
  }
}
