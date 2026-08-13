import { requirePosSession } from "@/lib/pos-session-guard";

type PromptPayQrProxyPayload = {
  path?: string | null;
};

const PROMPTPAY_PATH_PATTERN = /^\/(\d{9,15})\/(\d+(?:\.\d{1,2})?)\/?$/;
const MAX_QR_IMAGE_BYTES = 900_000;
const UPSTREAM_TIMEOUT_MS = 5_000;

function fail(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(req: Request) {
  try {
    await requirePosSession();

    const body = (await req.json()) as PromptPayQrProxyPayload;
    const requestedPath = String(body.path ?? "").trim();
    const matchedPath = requestedPath.match(PROMPTPAY_PATH_PATTERN);
    if (!matchedPath) {
      return fail("promptpay_qr_path_invalid", "PromptPay QR path is invalid.", 422);
    }

    const phone = matchedPath[1];
    const amount = matchedPath[2];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      const upstream = await fetch(`https://promptpay.io/${phone}/${amount}`, {
        method: "GET",
        headers: {
          accept: "image/png,image/webp,image/jpeg,image/*;q=0.9,*/*;q=0.1"
        },
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal
      });

      if (!upstream.ok) {
        return fail("promptpay_qr_upstream_failed", `PromptPay QR upstream returned ${upstream.status}.`, 502);
      }

      const contentType = String(upstream.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.startsWith("image/")) {
        return fail("promptpay_qr_upstream_not_image", "PromptPay QR upstream did not return an image.", 502);
      }

      const imageBytes = await upstream.arrayBuffer();
      if (imageBytes.byteLength <= 0 || imageBytes.byteLength > MAX_QR_IMAGE_BYTES) {
        return fail("promptpay_qr_image_size_invalid", "PromptPay QR image size is invalid.", 502);
      }

      return new Response(imageBytes, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "private, no-store, max-age=0",
          "X-Content-Type-Options": "nosniff"
        }
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "PromptPay QR proxy failed.";
    return fail("promptpay_qr_proxy_failed", message, 500);
  }
}
