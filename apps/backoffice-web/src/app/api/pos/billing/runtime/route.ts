import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { loadPosSubscriptionLifecycleGuard } from "@/lib/services/pos-subscription-lifecycle-guard-service";

export const dynamic="force-dynamic";

export async function GET(){
  try{
    const scope=await requirePosSession();
    const runtime=await loadPosSubscriptionLifecycleGuard(scope.session.tenant_id,{forceFresh:true});
    const response=ok({runtime});
    response.headers.set("cache-control","private, no-store");
    return response;
  }catch(error){
    if(error instanceof PosGuardError)return fail(error.code,error.message,error.status);
    return fail("subscription_runtime_failed","Unable to refresh subscription status.",503);
  }
}
