import "server-only";
import { createSign } from "node:crypto";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type NativeQrPushKind = "order" | "call_staff" | "request_checkout";
export type NativeQrPushEvent = {
  tenantId: string;
  branchId: string;
  eventId: string;
  tableId: string;
  tableCode: string;
  kind: NativeQrPushKind;
  itemCount?: number;
};

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
let cachedToken: { value: string; expiresAt: number } | null = null;

export function notificationForNativeQr(kind: NativeQrPushKind, tableCode: string) {
  const label = tableCode.slice(0, 24);
  switch (kind) {
    case "order": return { title: "มีรายการสั่งอาหารใหม่", body: "โต๊ะ " + label + " สั่งอาหารเข้ามา" };
    case "call_staff": return { title: "ลูกค้าเรียกพนักงาน", body: "โต๊ะ " + label + " ต้องการพนักงาน" };
    case "request_checkout": return { title: "ลูกค้าเรียกชำระเงิน", body: "โต๊ะ " + label + " ขอชำระเงิน" };
  }
}

function config() {
  const project = process.env.NATIVE_FCM_PROJECT_ID?.trim();
  const email = process.env.NATIVE_FCM_CLIENT_EMAIL?.trim();
  const key = process.env.NATIVE_FCM_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!project || !email || !key) return null;
  if (!/^[a-z0-9-]{4,90}$/.test(project) || !email.includes("@") ||
      !key.includes("BEGIN PRIVATE KEY")) return null;
  return { project, email, key };
}

async function getAccessToken(credentials: NonNullable<ReturnType<typeof config>>) {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 120000) return cachedToken.value;
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const issuedAt = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: credentials.email, scope: FCM_SCOPE,
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAt, exp: issuedAt + 3300
  })).toString("base64url");
  const signingInput = header + "." + payload;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const assertion = signingInput + "." + signer.sign(credentials.key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    }), cache: "no-store", signal: AbortSignal.timeout(7000)
  });
  if (!res.ok) throw new Error("fcm_oauth_http_" + res.status);
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("fcm_oauth_missing_token");
  cachedToken = { value: json.access_token,
    expiresAt: now + Math.max(300, Number(json.expires_in ?? 3000)) * 1000 };
  return json.access_token;
}

/**
 * Send data-only, high-priority QR events. No Firebase secrets or token leaks
 * to Android. Existing customer QR write path calls this AFTER successful commit,
 * ONLY when the request is not a duplicate. The Android client dedupes event IDs.
 * Delivery remains best-effort; clients also retain authenticated foreground poll.
 */
export async function dispatchNativeQrFcm(event: NativeQrPushEvent): Promise<void> {
  const credentials = config();
  if (!credentials) return;
  try {
    const supabase = getSupabaseServiceClient();
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    const { data, error } = await supabase.from("native_pos_push_devices")
      .select("installation_id,fcm_token")
      .eq("tenant_id", event.tenantId).eq("branch_id", event.branchId)
      .eq("enabled", true).gte("updated_at", cutoff)
      .order("updated_at", { ascending: false }).limit(40);
    if (error) {
      console.warn("[native-fcm] recipients unavailable", error.code);
      return;
    }
    const receivers = (data ?? []) as Array<{ installation_id: string; fcm_token: string }>;
    if (receivers.length === 0) return;
    const authorization = await getAccessToken(credentials);
    const message = notificationForNativeQr(event.kind, event.tableCode);
    const tokens = Array.from(new Set(receivers.map(row => row.fcm_token))).slice(0, 40);
    const results = await Promise.allSettled(tokens.map(async fcmToken => {
      const response = await fetch(
        "https://fcm.googleapis.com/v1/projects/" + credentials.project + "/messages:send", {
          method: "POST", cache: "no-store",
          headers: { authorization: "Bearer " + authorization, "content-type": "application/json" },
          body: JSON.stringify({
            message: {
              token: fcmToken,
              data: {
                type: "native_qr_event", event_id: event.eventId,
                event_type: event.kind, table_id: event.tableId,
                table_code: event.tableCode.slice(0, 24),
                title: message.title, body: message.body,
                item_count: String(event.itemCount ?? 0)
              },
              android: { priority: "HIGH", ttl: "3600s", restricted_package_name: undefined }
            }
          }),
          signal: AbortSignal.timeout(8000)
        }
      );
      if (response.status === 404 || response.status === 400) {
        // Token invalidation is handled by rotation/periodic re-registration.
        // Never delete a token for a transient malformed server configuration.
        return false;
      }
      return response.ok;
    }));
    const failures = results.filter(result => result.status === "rejected" ||
      (result.status === "fulfilled" && !result.value)).length;
    if (failures) console.warn("[native-fcm] partial delivery failure", {
      kind: event.kind, count: failures, total: tokens.length
    });
  } catch (error) {
    console.warn("[native-fcm] dispatch unavailable",
      error instanceof Error ? error.name : "unknown_error");
  }
}
