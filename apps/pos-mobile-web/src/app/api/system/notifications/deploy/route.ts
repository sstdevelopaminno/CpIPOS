import { fail, ok } from "@/lib/api/response";
import { getEnv } from "@/lib/env";
import { sendMobilePush } from "@/lib/notifications/web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(request: Request) {
  const secret = getEnv().DEPLOY_NOTIFY_SECRET;
  if (!secret) return false;
  const header = request.headers.get("x-deploy-notify-secret") ?? "";
  return header.length === secret.length && header === secret;
}

export async function POST(request: Request) {
  try {
    if (!isAuthorized(request)) return fail("unauthorized", "Unauthorized", 401);

    const body = await request.json().catch(() => null) as { title?: string; message?: string; url?: string; version?: string } | null;
    const title = body?.title?.trim() || "CpIPOS Mobile อัปเดตแล้ว";
    const version = body?.version?.trim();
    const message = body?.message?.trim() || (version ? `ระบบอัปเดตเวอร์ชัน ${version} พร้อมใช้งาน` : "ระบบอัปเดตเวอร์ชันล่าสุดพร้อมใช้งาน");

    return ok(await sendMobilePush({
      title,
      message,
      url: body?.url?.startsWith("/") ? body.url : "/sales",
      tag: version ? `sstipos-deploy-${version}` : `sstipos-deploy-${Date.now()}`,
      renotify: true,
    }));
  } catch (error) {
    console.error("[system.notifications.deploy]", error);
    return fail("deploy_push_failed", "Deploy notification failed", 503);
  }
}
