import { fail, ok } from "@/lib/api/response";
import { appendMobileAuditLog } from "@/lib/audit/mobile-audit-log";
import { verifyEmployeeCode } from "@/lib/auth/mobile-auth-service";
import { readMobileFlow, writeMobileFlow } from "@/lib/auth/mobile-flow";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { employeeVerifySchema } from "@/lib/validation/auth";

export async function POST(request: Request) {
  try {
    const flow = await readMobileFlow();
    if (!flow) return fail("context_expired", "เซสชันเข้าสู่ระบบหมดอายุ", 401);

    const body = employeeVerifySchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return fail("invalid_input", "รหัสพนักงานต้องเป็นตัวเลขเท่านั้น", 422);

    if (!checkRateLimit(`employee:${flow.tenantId}:${flow.branchId ?? "none"}:${body.data.employeeCode}`)) {
      return fail("rate_limited", "ลองใหม่อีกครั้งภายหลัง", 429);
    }

    const result = await verifyEmployeeCode(flow, body.data.employeeCode);
    if (!result || !flow.branchId) return fail("invalid_credentials", "รหัสพนักงานไม่ถูกต้อง", 401);

    await appendMobileAuditLog({
      tenantId: flow.tenantId,
      branchId: flow.branchId,
      actorUserId: result.user.id,
      actorRole: result.role,
      action: "mobile_employee_verified",
      targetTable: "pos_login_contexts",
      targetUserId: result.user.id,
      metadata: { tenant_code: flow.tenantCode, branch_id: flow.branchId, employee_code: body.data.employeeCode },
    });

    const response = ok({ user: result.user, role: result.role, redirectTo: "/login/device" });
    writeMobileFlow(response, result.flow);
    return response;
  } catch (error) {
    console.error("[employee.verify]", error);
    return fail("employee_verify_error", "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่", 503);
  }
}
