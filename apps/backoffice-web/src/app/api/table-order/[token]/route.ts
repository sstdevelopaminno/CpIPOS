import { fail, ok } from "@/lib/http";
import { PosTimeoutError, withTimeout } from "@/lib/pos-resilience";
import { loadTableQrMenu, resolveTableQrContext, submitTableQrOrder, submitTableQrServiceRequest } from "@/lib/table-qr-ordering";

type SubmitPayload = {
  action?: "order" | "call_staff" | "request_checkout";
  event_type?: "order" | "call_staff" | "request_checkout";
  request_id?: string;
  note?: string | null;
  items?: Array<{ product_id?: string; quantity?: number; note?: string | null }>;
};

type PublicErrorMeta = {
  method: "GET" | "POST";
  token?: string;
  action?: string;
  requestId?: string;
  itemCount?: number;
};

const requestBuckets = new Map<string, { count: number; resetAt: number }>();
const TABLE_ORDER_GET_TIMEOUT_MS = 30000;

function getClientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

function rateLimit(request: Request, token: string): boolean {
  const now = Date.now();
  if (requestBuckets.size > 2000) {
    for (const [bucketKey, bucket] of requestBuckets) {
      if (bucket.resetAt <= now) requestBuckets.delete(bucketKey);
    }
  }

  const key = `${getClientIp(request)}:${token.slice(0, 36)}`;
  const current = requestBuckets.get(key);

  if (!current || current.resetAt <= now) {
    requestBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (current.count >= 20) return false;
  current.count += 1;
  return true;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Table ordering is unavailable.";
  }
}

function includesAny(message: string, values: string[]) {
  const normalized = message.toLowerCase();
  return values.some((value) => normalized.includes(value.toLowerCase()));
}

function publicError(error: unknown, meta: PublicErrorMeta) {
  const message = getErrorMessage(error);
  const isDev = process.env.NODE_ENV !== "production";

  console.error("[table-order-api] public table order failed", {
    method: meta.method,
    action: meta.action,
    requestId: meta.requestId,
    itemCount: meta.itemCount,
    tokenPreview: meta.token ? `${meta.token.slice(0, 10)}...${meta.token.slice(-6)}` : undefined,
    message
  });

  if (
    includesAny(message, [
      "invalid_qr_token",
      "qr_session_expired",
      "QR_SESSION_EXPIRED",
      "TABLE_SESSION_CLOSED",
      "table_session_closed",
      "token_expired",
      "expired_token"
    ])
  ) {
    return fail("table_order_link_expired", "ลิงก์สั่งอาหารหมดอายุหรือปิดบิลแล้ว", 410);
  }

  if (
    includesAny(message, [
      "FOOD_ORDER_REQUIRED_BEFORE_CHECKOUT",
      "food_order_required_before_checkout"
    ])
  ) {
    return fail("food_order_required_before_checkout", "กรุณาส่งรายการอาหารก่อนแจ้งชำระบิล", 409);
  }

  if (
    includesAny(message, [
      "table_order_not_available",
      "ORDER_NOT_QUEUED",
      "order_not_queued",
      "ORDER_NOT_APPENDABLE",
      "order_not_appendable",
      "TABLE_BILL_NOT_OPEN",
      "table_bill_not_open",
      "BILL_NOT_OPEN",
      "bill_not_open",
      "pending_payment",
      "closed",
      "cancelled"
    ])
  ) {
    return fail(
      "table_order_not_available",
      "โต๊ะนี้ไม่สามารถสั่งอาหารเพิ่มได้แล้ว อาจกำลังรอชำระเงินหรือปิดบิลแล้ว กรุณาติดต่อพนักงาน",
      409
    );
  }

  if (includesAny(message, ["SHIFT_NOT_OPEN", "shift_not_open", "active_shift_not_found", "no_open_shift"])) {
    return fail("shift_not_open", "ร้านยังไม่พร้อมรับรายการในขณะนี้", 409);
  }

  if (includesAny(message, ["PRODUCT_NOT_AVAILABLE", "product_unavailable", "product_not_found", "product_inactive"])) {
    return fail("product_unavailable", "มีเมนูที่ไม่พร้อมจำหน่าย กรุณาโหลดใหม่", 409);
  }

  if (includesAny(message, ["INVALID_ITEM", "ITEMS_REQUIRED", "invalid_items", "invalid_order_items"])) {
    return fail("invalid_items", "กรุณาเลือกรายการอาหารให้ถูกต้อง", 422);
  }

  if (
    includesAny(message, [
      "submit_table_qr_order_tx",
      "could not find",
      "schema cache",
      "function",
      "PGRST202",
      "rpc"
    ])
  ) {
    return fail(
      "table_order_rpc_failed",
      isDev ? message : "ระบบส่งรายการอาหารยังไม่พร้อมใช้งาน กรุณาติดต่อพนักงาน",
      500
    );
  }

  return fail(
    "table_order_failed",
    isDev ? message : "ไม่สามารถส่งรายการได้ กรุณาลองใหม่หรือติดต่อพนักงาน",
    500
  );
}

function normalizeAction(body: SubmitPayload) {
  return body.action ?? body.event_type ?? "order";
}

function normalizeItems(body: SubmitPayload) {
  return (body.items ?? []).map((item) => ({
    product_id: String(item.product_id ?? "").trim(),
    quantity: Number(item.quantity),
    note: typeof item.note === "string" ? item.note.trim().slice(0, 240) : null
  }));
}

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  let token = "";
  const startedAt = Date.now();

  try {
    const params = await context.params;
    token = params.token;

    if (!rateLimit(request, token)) return fail("rate_limited", "กรุณารอสักครู่แล้วลองใหม่", 429);

    const data = await withTimeout(
      (async () => {
        const qrContext = await resolveTableQrContext(token);
        return loadTableQrMenu(qrContext);
      })(),
      TABLE_ORDER_GET_TIMEOUT_MS,
      "table_order_menu_timeout"
    );
    const response = ok(data);
    response.headers.set("x-table-order-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    if (error instanceof PosTimeoutError) {
      const response = fail("table_order_menu_timeout", "โหลดเมนูใช้เวลานานเกินไป กรุณาลองสแกน QR ใหม่อีกครั้ง", 503);
      response.headers.set("x-table-order-ms", String(Date.now() - startedAt));
      return response;
    }
    return publicError(error, { method: "GET", token });
  }
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  let token = "";
  let action = "order";
  let requestId = "";
  let itemCount = 0;

  try {
    const params = await context.params;
    token = params.token;

    if (!rateLimit(request, token)) return fail("rate_limited", "กรุณารอสักครู่แล้วลองใหม่", 429);

    const body = (await request.json().catch(() => null)) as SubmitPayload | null;
    if (!body || typeof body !== "object") {
      return fail("invalid_payload", "Invalid request body.", 422);
    }

    action = normalizeAction(body);
    requestId = String(body.request_id ?? request.headers.get("x-idempotency-key") ?? "").trim();

    if (!requestId || requestId.length > 120) {
      return fail("invalid_request_id", "Invalid request id.", 422);
    }

    if (action === "call_staff" || action === "request_checkout") {
      const qrContext = await resolveTableQrContext(token);
      const result = await submitTableQrServiceRequest({
        context: qrContext,
        requestId,
        requestType: action,
        note: typeof body.note === "string" ? body.note.trim().slice(0, 500) : null
      });

      return ok(
        {
          submission_id: result.submission_id,
          table_code: qrContext.table_code,
          action,
          duplicate_request: result.duplicate_request
        },
        result.duplicate_request ? 200 : 201
      );
    }

    if (action !== "order") return fail("invalid_action", "Invalid action.", 422);

    const items = normalizeItems(body);
    itemCount = items.length;

    if (items.length < 1 || items.length > 50) {
      return fail("invalid_items", "กรุณาเลือกเมนู 1-50 รายการ", 422);
    }

    if (items.some((item) => !item.product_id || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)) {
      return fail("invalid_items", "จำนวนอาหารไม่ถูกต้อง", 422);
    }

    const qrContext = await resolveTableQrContext(token);
    const result = await submitTableQrOrder({
      context: qrContext,
      requestId,
      items,
      note: typeof body.note === "string" ? body.note.trim().slice(0, 500) : null
    });

    return ok(
      {
        submission_id: result.submission_id,
        order_no: result.order_no,
        table_code: qrContext.table_code,
        subtotal: Number(result.subtotal),
        tax_total: Number(result.tax_total),
        grand_total: Number(result.grand_total),
        duplicate_request: result.duplicate_request
      },
      result.duplicate_request ? 200 : 201
    );
  } catch (error) {
    return publicError(error, { method: "POST", token, action, requestId, itemCount });
  }
}
