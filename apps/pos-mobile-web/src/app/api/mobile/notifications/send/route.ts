import { fail, ok } from "@/lib/api/response";
import { requireActiveMobileSession } from "@/lib/auth/session";
import { getEnv } from "@/lib/env";
import { sendMobilePush } from "@/lib/notifications/web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const scope = await requireActiveMobileSession({ refreshCookie: true });
    if (!scope) return fail("missing_session", "กรุณาเข้าสู่ระบบ", 401);
    if (!["owner", "manager"].includes(scope.role)) return fail("forbidden", "ไม่มีสิทธิ์ส่งแจ้งเตือน", 403);

    const env = getEnv();
    if (!env.WEB_PUSH_PUBLIC_KEY || !env.WEB_PUSH_PRIVATE_KEY) {
      return fail("push_not_configured", "ยังไม่ได้ตั้งค่า Web Push VAPID", 501);
    }

    const body = await request.json().catch(() => null) as { title?: string; message?: string; url?: string } | null;
    const title = body?.title?.trim() || "CpIPOS Mobile";
    const message = body?.message?.trim() || "มีการแจ้งเตือนใหม่";
    const url = body?.url?.startsWith("/") ? body.url : "/sales";

    return ok(await sendMobilePush({ title, message, url, tenantId: scope.tenantId, branchId: scope.branchId, tag: `manual-${Date.now()}`, renotify: true }));
  } catch (error) {
    console.error("[mobile.notifications.send]", error);
    return fail("push_send_failed", "ส่งแจ้งเตือนไม่สำเร็จ", 503);
  }
}
