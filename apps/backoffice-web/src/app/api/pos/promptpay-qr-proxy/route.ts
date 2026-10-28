import QRCode from "qrcode";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { buildPromptPayPayload } from "@/lib/payments/promptpay-billing-qr";
import { getTenantPosCurrencyCode } from "@/lib/server/custom-pos-currency";

type PromptPayQrProxyPayload = { path?: string | null };

const PROMPTPAY_PATH_PATTERN = /^\/(\d{9,15})\/(\d+(?:\.\d{1,2})?)\/?$/;
const MAX_QR_IMAGE_BYTES = 900_000;

function fail(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, {
    status,
    headers: { "Cache-Control": "private, no-store" }
  });
}

/**
 * Native POS expects PNG bytes from this authenticated route.
 * Rendering the canonical EMV payload locally removes the third-party
 * promptpay.io dependency (which could return errors or non-image content).
 * QR generation never changes payment state or confirms that money arrived.
 */
export async function POST(req: Request) {
  try {
    const scope = await requirePosSession();
    if (await getTenantPosCurrencyCode(scope.session.tenant_id) === "LAK") {
      return fail("payment_provider_currency_unsupported", "Thai PromptPay QR is unavailable for LAK sales.", 422);
    }

    const body = await req.json().catch(() => null) as PromptPayQrProxyPayload | null;
    const requestedPath = typeof body?.path === "string" ? body.path.trim() : "";
    const matchedPath = requestedPath.match(PROMPTPAY_PATH_PATTERN);
    if (!matchedPath) {
      return fail("promptpay_qr_path_invalid", "PromptPay QR path is invalid.", 422);
    }

    const amount = Number(matchedPath[2]);
    const payload = buildPromptPayPayload(matchedPath[1], amount);
    if (!payload) {
      return fail("promptpay_qr_account_invalid", "Please configure a valid Thai PromptPay ID in POS payment settings.", 422);
    }

    const png = await QRCode.toBuffer(payload, {
      type: "png",
      width: 320,
      margin: 2,
      errorCorrectionLevel: "M"
    });

    if (png.byteLength === 0 || png.byteLength > MAX_QR_IMAGE_BYTES) {
      return fail("promptpay_qr_image_size_invalid", "Generated PromptPay QR image size is invalid.", 500);
    }

    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    if (error instanceof PosGuardError) {
      return fail(error.code, error.message, error.status);
    }
    return fail("promptpay_qr_render_failed", "Unable to generate PromptPay QR. Please retry.", 500);
  }
}
