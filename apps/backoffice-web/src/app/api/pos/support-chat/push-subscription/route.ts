import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type SubscriptionInput = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

export async function GET() {
  try {
    await requirePosSession();
    const db = getPrimarySupabaseServiceClient();
    const config = await db.from("support_push_config").select("vapid_public_key").eq("id","default").single<{vapid_public_key:string}>();
    if (config.error || !config.data?.vapid_public_key) return fail("push_config_missing","Push notification is not configured.",503);
    return ok({ public_key: config.data.vapid_public_key });
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code,error.message,error.status);
    return fail("push_subscription_failed","Unable to load push configuration.",503);
  }
}

export async function POST(request: Request) {
  try {
    const scope = await requirePosSession();
    const body = await request.json().catch(() => null) as SubscriptionInput | null;
    const endpoint = String(body?.endpoint ?? "").trim();
    const p256dh = String(body?.keys?.p256dh ?? "").trim();
    const auth = String(body?.keys?.auth ?? "").trim();
    if (!endpoint.startsWith("https://") || !p256dh || !auth) return fail("push_subscription_invalid","Invalid push subscription.",422);

    const db = getPrimarySupabaseServiceClient();
    const result = await db.from("support_push_subscriptions").upsert({
      audience_type: "store",
      tenant_id: scope.session.tenant_id,
      user_id: scope.session.user_id,
      endpoint,
      p256dh,
      auth,
      user_agent: request.headers.get("user-agent"),
      enabled: true,
      updated_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString()
    }, { onConflict: "endpoint" });
    if (result.error) throw result.error;
    return ok({ subscribed: true });
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code,error.message,error.status);
    return fail("push_subscription_failed","Unable to save push subscription.",503);
  }
}
