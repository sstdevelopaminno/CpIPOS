import { fail, ok } from "@/lib/api/response";
import { selectDeviceAndCreateSession } from "@/lib/auth/mobile-auth-service";
import { clearMobileFlow, readMobileFlow } from "@/lib/auth/mobile-flow";
import { setMobileSessionCookie } from "@/lib/auth/session";
import { deviceSelectSchema } from "@/lib/validation/auth";

export async function POST(request: Request) {
  try {
    const flow = await readMobileFlow();
    if (!flow) return fail("context_expired", "เซสชันเข้าสู่ระบบหมดอายุ", 401);
    const body = deviceSelectSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return fail("invalid_input", "เลือกเครื่องแคชเชียร์ไม่ถูกต้อง", 422);

    const result = await selectDeviceAndCreateSession(flow, body.data.deviceId);
    if (!result || !flow.branchId) return fail("device_not_available", "เครื่องแคชเชียร์ไม่พร้อมใช้งาน", 409);

    const response = ok({ user: result.user, role: result.role, device: result.device, redirectTo: result.hasOpenShift ? "/sales" : "/shifts" });
    await setMobileSessionCookie({
      tenantId: flow.tenantId,
      branchId: flow.branchId,
      userId: result.user.id,
      role: result.role,
      sessionId: result.sessionId,
      deviceId: result.device.id,
      deviceCode: result.device.code,
      deviceName: result.device.name
    });
    clearMobileFlow(response);
    return response;
  } catch (error) {
    console.error("[devices.select]", error);
    return fail("device_select_error", "เลือกเครื่องแคชเชียร์ไม่สำเร็จ กรุณาลองใหม่", 503);
  }
}
