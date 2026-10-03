import { fail, ok } from "@/lib/http";
import { authorizePublicPackageCheckout, loadPublicPackageCatalog } from "@/lib/services/public-package-checkout-service";
import { buildRateLimitKey, enforceRateLimit, getClientIpAddress } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clean(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function checkoutError(error: unknown) {
  const message = error instanceof Error ? error.message : "public_checkout_failed";
  const map: Record<string, [string, string, number]> = {
    internal_demo_not_billable: ["internal_demo_not_billable", "บัญชีทดสอบภายในไม่สามารถซื้อแพ็กเกจจากเว็บไซต์ได้", 422],
    package_unavailable: ["package_unavailable", "แพ็กเกจนี้ยังไม่เปิดให้ซื้อผ่านเว็บไซต์", 422],
    yearly_unavailable: ["yearly_unavailable", "แพ็กเกจนี้ยังไม่เปิดรอบรายปี", 422],
    package_price_missing: ["package_price_missing", "ยังไม่พบราคาที่ใช้งานได้สำหรับแพ็กเกจนี้", 422],
    receiving_account_not_configured: ["receiving_account_not_configured", "บัญชีรับชำระของบริษัทยังไม่พร้อมใช้งาน", 503]
  };
  const found = map[message];
  return found ? fail(found[0], found[1], found[2]) : fail("public_checkout_failed", "ไม่สามารถเตรียมรายการซื้อแพ็กเกจได้ในขณะนี้", 503);
}

export async function GET() {
  try {
    const packages = await loadPublicPackageCatalog();
    const response = ok({ packages, generated_at: new Date().toISOString() });
    response.headers.set("cache-control", "public, max-age=60, s-maxage=300");
    return response;
  } catch (error) {
    console.error("[public-package-checkout] catalog failed", error);
    return fail("package_catalog_unavailable", "ไม่สามารถโหลดราคาแพ็กเกจได้ในขณะนี้", 503);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as {
    store_code?: unknown;
    pin?: unknown;
    package_id?: unknown;
    billing_interval?: unknown;
  } | null;

  const storeCode = clean(body?.store_code, 32).toUpperCase();
  const pin = clean(body?.pin, 32);
  const packageId = clean(body?.package_id, 80);
  const billingInterval = clean(body?.billing_interval, 12);

  if (!storeCode || !pin || !packageId || !["monthly", "yearly"].includes(billingInterval)) {
    return fail("checkout_fields_required", "กรอกรหัสร้าน PIN และเลือกแพ็กเกจให้ครบ", 422);
  }

  const ip = getClientIpAddress(request);
  const limit = await enforceRateLimit({
    namespace: "public_package_checkout_verify",
    key: buildRateLimitKey({ namespace: "public-package-checkout", parts: [ip, storeCode] }),
    max: 8,
    windowMs: 5 * 60_000,
    failClosedOnBackendError: true
  });
  if (!limit.ok) {
    const response = fail("rate_limited", "มีการยืนยันรหัสผิดหลายครั้ง กรุณารอสักครู่แล้วลองใหม่", 429);
    response.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return response;
  }

  try {
    const result = await authorizePublicPackageCheckout({
      storeCode,
      pin,
      packageId,
      billingInterval: billingInterval as "monthly" | "yearly"
    });
    if (!result) return fail("store_or_pin_invalid", "รหัสร้านหรือ PIN ไม่ถูกต้อง หรือ PIN ไม่ใช่ของ Owner/Manager", 401);

    const response = ok(result);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    console.error("[public-package-checkout] authorization failed", error);
    return checkoutError(error);
  }
}
