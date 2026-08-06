import "server-only";

import webpush from "web-push";
import { getEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";

type PushRow = {
  endpoint: string;
  subscription: webpush.PushSubscription;
};

type SendOptions = {
  title: string;
  message: string;
  url?: string;
  tenantId?: string;
  branchId?: string;
  tag?: string;
  renotify?: boolean;
};

export async function sendMobilePush(options: SendOptions) {
  const env = getEnv();
  if (!env.WEB_PUSH_PUBLIC_KEY || !env.WEB_PUSH_PRIVATE_KEY) {
    return { configured: false, sent: 0, failed: 0, expired: 0 };
  }

  webpush.setVapidDetails(env.WEB_PUSH_SUBJECT, env.WEB_PUSH_PUBLIC_KEY, env.WEB_PUSH_PRIVATE_KEY);

  const supabase = createServiceClient();
  let query = supabase
    .from("mobile_push_subscriptions")
    .select("endpoint,subscription")
    .eq("status", "active")
    .limit(500);

  if (options.tenantId) query = query.eq("tenant_id", options.tenantId);
  if (options.branchId) query = query.eq("branch_id", options.branchId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as PushRow[];
  const payload = JSON.stringify({
    title: options.title,
    body: options.message,
    url: options.url?.startsWith("/") ? options.url : "/sales",
    icon: "/brand/cpipos-icon-transparent-192.png",
    badge: "/brand/cpipos-icon-transparent-192.png",
    tag: options.tag,
    renotify: options.renotify,
  });

  let sent = 0;
  let failed = 0;
  let expired = 0;

  await Promise.all(rows.map(async (row) => {
    try {
      await webpush.sendNotification(row.subscription, payload);
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode = typeof error === "object" && error && "statusCode" in error ? Number(error.statusCode) : 0;
      if (statusCode === 404 || statusCode === 410) {
        expired += 1;
        await supabase
          .from("mobile_push_subscriptions")
          .update({ status: "expired", last_error: `web_push_${statusCode}`, updated_at: new Date().toISOString() })
          .eq("endpoint", row.endpoint);
      }
    }
  }));

  return { configured: true, sent, failed, expired };
}
