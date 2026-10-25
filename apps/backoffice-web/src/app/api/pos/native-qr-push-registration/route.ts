import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { PosGuardError, requirePosSession, requirePermission, withPosSessionCookie } from "@/lib/pos-session-guard";

/**
 * Register/revoke THIS authenticated Android installation, not a caller-
 * controlled branch, tenant or employee. No FCM server credentials in APK.
 */
function failure(code: string, status: number) {
  return NextResponse.json({ data: null, error: { code, message: code } }, { status });
}
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export async function PUT(req: Request) {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "sales:view");
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const installation = String(body?.installation_id ?? "").trim();
    const fcmToken = String(body?.fcm_token ?? "").trim();
    const appId = String(body?.app_id ?? "").trim();
    if (!uuidPattern.test(installation) ||
        fcmToken.length < 50 || fcmToken.length > 4096 ||
        !/^[A-Za-z0-9:_\-\.]+$/.test(fcmToken) ||
        !["com.cpipos.pos.next", "com.cpipos.pos.next.dev"].includes(appId)) {
      return failure("invalid_native_push_registration", 422);
    }
    const db = getSupabaseServiceClient();
    const { error } = await db.from("native_pos_push_devices").upsert({
      installation_id: installation,
      tenant_id: scope.session.tenant_id,
      branch_id: scope.session.branch_id,
      device_code: scope.session.device_code,
      user_id: scope.session.user_id,
      fcm_token: fcmToken,
      app_id: appId,
      enabled: true,
      updated_at: new Date().toISOString()
    }, { onConflict: "installation_id" });
    if (error) return failure("native_push_registration_failed", 503);
    return withPosSessionCookie(NextResponse.json({
      data: { registered: true, branch_id: scope.session.branch_id }, error: null
    }), scope.session.id);
  } catch (e) {
    if (e instanceof PosGuardError) return failure(e.code, e.status);
    return failure("native_push_registration_failed", 500);
  }
}

export async function DELETE(req: Request) {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "sales:view");
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const installation = String(body?.installation_id ?? "").trim();
    if (!uuidPattern.test(installation)) return failure("invalid_native_installation", 422);
    const { error } = await getSupabaseServiceClient()
      .from("native_pos_push_devices").update({
        enabled: false, updated_at: new Date().toISOString()
      }).eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", scope.session.branch_id)
      .eq("installation_id", installation);
    if (error) return failure("native_push_unregistration_failed", 503);
    return withPosSessionCookie(NextResponse.json({
      data: { unregistered: true }, error: null
    }), scope.session.id);
  } catch (e) {
    if (e instanceof PosGuardError) return failure(e.code, e.status);
    return failure("native_push_unregistration_failed", 500);
  }
}
