import { fail, ok } from "@/lib/api/response";
import { listBranches, selectBranch } from "@/lib/auth/mobile-auth-service";
import { readMobileFlow, writeMobileFlow } from "@/lib/auth/mobile-flow";
import { branchSelectSchema } from "@/lib/validation/auth";

export async function GET() {
  try {
    const flow = await readMobileFlow();
    if (!flow) return fail("context_expired", "เซสชันเข้าสู่ระบบหมดอายุ", 401);
    const branches = await listBranches(flow);
    return ok({ tenant: { id: flow.tenantId, code: flow.tenantCode, name: flow.tenantName }, branches });
  } catch (error) {
    console.error("[branches.select.GET]", error);
    return fail("branch_load_error", "ไม่สามารถโหลดสาขาได้ กรุณาลองใหม่", 503);
  }
}

export async function POST(request: Request) {
  try {
    const flow = await readMobileFlow();
    if (!flow) return fail("context_expired", "เซสชันเข้าสู่ระบบหมดอายุ", 401);
    const body = branchSelectSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return fail("invalid_input", "เลือกสาขาไม่ถูกต้อง", 422);

    const nextFlow = await selectBranch(flow, body.data.branchId);
    if (!nextFlow) return fail("branch_not_found", "ไม่พบสาขาที่เลือก", 404);

    const response = ok({ selected: true, redirectTo: "/login/employee" });
    writeMobileFlow(response, nextFlow);
    return response;
  } catch (error) {
    console.error("[branches.select.POST]", error);
    return fail("branch_select_error", "เลือกสาขาไม่สำเร็จ กรุณาลองใหม่", 503);
  }
}
