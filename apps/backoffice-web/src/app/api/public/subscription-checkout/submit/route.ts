import { fail, ok } from "@/lib/http";
import { submitPublicPackageCheckout } from "@/lib/services/public-package-checkout-service";
import { buildRateLimitKey, enforceRateLimit, getClientIpAddress } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY = 4 * 1024 * 1024 + 16_000;

function messageFor(error: unknown) {
  const message = error instanceof Error ? error.message : "subscription_request_failed";
  const map: Record<string, [string, string, number]> = {
    checkout_token_invalid: ["checkout_token_invalid", "เซสชันการซื้อหมดอายุ กรุณายืนยันรหัสร้านและ PIN ใหม่", 401],
    package_unavailable: ["package_unavailable", "แพ็กเกจนี้ไม่พร้อมซื้อผ่านเว็บไซต์", 422],
    package_price_changed: ["package_price_changed", "ราคาแพ็กเกจมีการเปลี่ยนแปลง กรุณากลับไปเลือกแพ็กเกจใหม่", 409],
    receiving_account_not_configured: ["receiving_account_not_configured", "บัญชีรับชำระของบริษัทยังไม่พร้อมใช้งาน", 503],
    open_request_exists: ["open_request_exists", "ร้านนี้มีคำขอแพ็กเกจที่กำลังรอตรวจสอบอยู่แล้ว", 409],
    slip_required: ["slip_required", "กรุณาแนบสลิป JPG, PNG หรือ WebP ขนาดไม่เกิน 4 MB", 422],
    slip_type_invalid: ["slip_type_invalid", "ชนิดไฟล์สลิปไม่ถูกต้อง", 422],
    slip_upload_failed: ["slip_upload_failed", "ยังไม่สามารถจัดเก็บสลิปได้ กรุณาลองใหม่", 503]
  };
  const found = map[message];
  return found ? fail(found[0], found[1], found[2]) : fail("subscription_request_failed", "ส่งคำขอชำระแพ็กเกจไม่สำเร็จ กรุณาลองใหม่", 503);
}

export async function POST(request: Request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY) return fail("upload_too_large", "ไฟล์สลิปต้องมีขนาดไม่เกิน 4 MB", 413);

  const ip = getClientIpAddress(request);
  const limit = await enforceRateLimit({
    namespace: "public_package_checkout_submit",
    key: buildRateLimitKey({ namespace: "public-package-checkout-submit", parts: [ip] }),
    max: 12,
    windowMs: 10 * 60_000,
    failClosedOnBackendError: true
  });
  if (!limit.ok) {
    const response = fail("rate_limited", "มีการส่งรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่", 429);
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }

  const form = await request.formData().catch(() => null);
  if (!form) return fail("invalid_form", "ไม่สามารถอ่านข้อมูลการชำระได้", 422);

  const token = typeof form.get("checkout_token") === "string" ? String(form.get("checkout_token")).trim() : "";
  const note = typeof form.get("note") === "string" ? String(form.get("note")).trim().slice(0, 500) : "";
  const slip = form.get("slip");
  if (!token || !(slip instanceof File)) return fail("checkout_fields_required", "เซสชันการซื้อและสลิปเป็นข้อมูลที่จำเป็น", 422);

  try {
    const result = await submitPublicPackageCheckout({ token, slip, note });
    const response = ok(result);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    console.error("[public-package-checkout] submission failed", error);
    return messageFor(error);
  }
}
