import { fail, ok } from "@/lib/api/response";
import { requireActiveMobileSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PushSubscriptionPayload = {
  endpoint?: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
};

export async function POST(request: Request) {
  try {
    const scope = await requireActiveMobileSession({ refreshCookie: true });
    if (!scope) return fail("missing_session", "กรุณาเข้าสู่ระบบ", 401);

    const body = await request.json().catch(() => null) as { subscription?: PushSubscriptionPayload } | null;
    const subscription = body?.subscription;
    if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys.auth) {
      return fail("invalid_subscription", "ข้อมูลแจ้งเตือนไม่ถูกต้อง", 400);
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      .from("mobile_push_subscriptions")
      .upsert({
        tenant_id: scope.tenantId,
        branch_id: scope.branchId,
        user_id: scope.userId,
        device_id: scope.deviceId,
        endpoint: subscription.endpoint,
        subscription,
        user_agent: request.headers.get("user-agent"),
        status: "active",
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "endpoint" });

    if (error) throw new Error(error.message);

    return ok({ subscribed: true });
  } catch (error) {
    console.error("[mobile.notifications.subscribe]", error);
    return fail("push_subscribe_failed", "บันทึกการแจ้งเตือนไม่สำเร็จ", 503);
  }
}
