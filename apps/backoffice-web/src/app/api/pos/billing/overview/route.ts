import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { loadPosSubscriptionCenter } from "@/lib/services/pos-subscription-center-service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const scope = await requirePosSession();
    if (!["owner", "manager"].includes(scope.session.role)) {
      return fail("forbidden", "Store owner or manager access required.", 403);
    }
    const data = await loadPosSubscriptionCenter(scope.session.tenant_id);
    const response = ok(data);
    response.headers.set("cache-control","private, no-store");
    return response;
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code,error.message,error.status);
    console.error("[pos-subscription] overview failed",error);
    return fail("subscription_overview_unavailable","Subscription information is temporarily unavailable.",503);
  }
}
