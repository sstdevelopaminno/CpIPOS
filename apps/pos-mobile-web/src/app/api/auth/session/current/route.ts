import { fail, ok } from "@/lib/api/response";
import { requireActiveMobileSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const scope = await requireActiveMobileSession({ refreshCookie: true });
    if (!scope) return fail("missing_session", "ยังไม่มีเซสชันที่ใช้งานอยู่", 401);

    const { data: shift, error } = await createServiceClient()
      .from("shifts")
      .select("id")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("device_code", scope.deviceCode)
      .eq("status", "open")
      .maybeSingle<{ id: string }>();
    if (error) throw new Error(error.message);

    return ok({
      authenticated: true,
      redirectTo: shift ? "/sales" : "/shifts",
      scope: {
        role: scope.role,
        deviceName: scope.deviceName,
      },
    });
  } catch (error) {
    console.error("[session.current]", error);
    return fail("session_check_failed", "ตรวจสอบเซสชันไม่สำเร็จ", 503);
  }
}
