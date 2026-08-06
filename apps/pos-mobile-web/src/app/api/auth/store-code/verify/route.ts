import { fail, ok } from "@/lib/api/response";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { verifyStoreCode } from "@/lib/auth/mobile-auth-service";
import { storeCodeSchema } from "@/lib/validation/auth";
import { writeMobileFlow } from "@/lib/auth/mobile-flow";

export async function POST(request: Request) {
  try {
    const body = storeCodeSchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return fail("invalid_input", "กรุณากรอกรหัสร้านให้ถูกต้อง", 422);
    if (!checkRateLimit(`store:${body.data.storeCode}`)) return fail("rate_limited", "ลองใหม่อีกครั้งภายหลัง", 429);

    const result = await verifyStoreCode(body.data.storeCode);
    if (!result) return fail("invalid_store", "ไม่พบร้านหรือร้านยังไม่พร้อมใช้งาน", 401);

    const response = ok({ tenant: result.tenant, branches: result.branches, nextStep: result.nextStep });
    writeMobileFlow(response, result.flow);
    return response;
  } catch (error) {
    console.error("[store-code.verify]", error);
    return fail("auth_service_error", "ไม่สามารถตรวจสอบรหัสร้านได้ กรุณาลองใหม่", 503);
  }
}
