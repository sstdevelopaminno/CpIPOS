import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePosSessionForShiftClose } from "@/lib/pos-session-guard";
import { loadPosSubscriptionLifecycleGuard } from "@/lib/services/pos-subscription-lifecycle-guard-service";

export const dynamic="force-dynamic";

export async function GET(request: Request){
  try{
    const scope=await requirePosSessionForShiftClose();
    // A normal focus/fallback request can reuse the short-lived (5s) tenant
    // cache. Realtime, push, online reconnection and legacy requests always
    // bypass it so approved payments and access revocations remain immediate.
    const reason=new URL(request.url).searchParams.get("reason");
    const forceFresh=reason!=="focus" && reason!=="fallback";
    const runtime=await loadPosSubscriptionLifecycleGuard(scope.session.tenant_id,{forceFresh});
    const response=ok({runtime});
    response.headers.set("cache-control","private, no-store");
    return response;
  }catch(error){
    if(error instanceof PosGuardError)return fail(error.code,error.message,error.status);
    return fail("subscription_runtime_failed","Unable to refresh subscription status.",503);
  }
}
