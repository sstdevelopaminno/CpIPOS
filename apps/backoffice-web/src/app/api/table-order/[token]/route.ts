import { fail, ok } from "@/lib/http";
import { loadProductMediaMap } from "@/lib/product-media";
import { PosTimeoutError, withTimeout } from "@/lib/pos-resilience";
import { buildRateLimitKey, enforceRateLimit, getClientIpAddress, type RateLimitResult } from "@/lib/server/rate-limit";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import {
  assertTableQrBuffetItemsAllowed,
  filterTableQrMenuForBuffet
} from "@/lib/table-qr-buffet-policy";
import { loadTableQrMenu, loadTableQrState, resolveTableQrContext, submitTableQrOrder, submitTableQrServiceRequest } from "@/lib/table-qr-ordering";
import { assertTableQrStockAvailable, loadTableQrStockStates } from "@/lib/table-qr-stock";

type SubmitPayload = {
  action?: "order" | "update_order" | "call_staff" | "request_checkout";
  event_type?: "order" | "update_order" | "call_staff" | "request_checkout";
  request_id?: string;
  note?: string | null;
  items?: Array<{
    product_id?: string;
    quantity?: number;
    note?: string | null;
    selected_ingredient_ids?: unknown;
  }>;
};

type PublicErrorMeta = { method: "GET" | "POST"; token?: string; action?: string; requestId?: string; itemCount?: number };
const TABLE_ORDER_GET_TIMEOUT_MS = 30000;
const TABLE_ORDER_RATE_LIMIT_WINDOW_MS = 60_000;
const TABLE_ORDER_MENU_RATE_LIMIT_MAX = 80;
const TABLE_ORDER_STATUS_RATE_LIMIT_MAX = 360;
const TABLE_ORDER_WRITE_RATE_LIMIT_MAX = 48;
const TABLE_ORDER_SESSION_READ_RATE_LIMIT_MAX = 1200;
const TABLE_ORDER_SESSION_WRITE_RATE_LIMIT_MAX = 240;
const TABLE_ORDER_MAX_RAW_INGREDIENT_SELECTIONS = 20;

function getTableOrderClientId(request: Request) {
  const raw = request.headers.get("x-table-order-client-id") ?? "";
  const normalized = raw.trim().toLowerCase();
  return /^[a-z0-9_-]{8,80}$/.test(normalized) ? normalized : "anonymous";
}

async function checkRateLimit(request: Request, token: string, lane: "menu" | "status" | "write"): Promise<RateLimitResult> {
  const sessionId = token.split(".", 1)[0]?.slice(0, 36) || "invalid";
  const ip = getClientIpAddress(request);
  const clientId = getTableOrderClientId(request);
  const sessionLimit = await enforceRateLimit({
    namespace: lane === "write" ? "table_order_public_write_session" : "table_order_public_read_session",
    key: buildRateLimitKey({ namespace: "table-order", parts: [lane, ip, sessionId] }),
    max: lane === "write" ? TABLE_ORDER_SESSION_WRITE_RATE_LIMIT_MAX : TABLE_ORDER_SESSION_READ_RATE_LIMIT_MAX,
    windowMs: TABLE_ORDER_RATE_LIMIT_WINDOW_MS,
    failClosedOnBackendError: true
  });
  if (!sessionLimit.ok) return sessionLimit;
  return enforceRateLimit({
    namespace: `table_order_public_${lane}`,
    key: buildRateLimitKey({ namespace: "table-order", parts: [lane, ip, sessionId, clientId] }),
    max: lane === "write" ? TABLE_ORDER_WRITE_RATE_LIMIT_MAX : lane === "status" ? TABLE_ORDER_STATUS_RATE_LIMIT_MAX : TABLE_ORDER_MENU_RATE_LIMIT_MAX,
    windowMs: TABLE_ORDER_RATE_LIMIT_WINDOW_MS,
    failClosedOnBackendError: true
  });
}

function rateLimitFailure(result: RateLimitResult) {
  const response = result.source === "backend_unavailable"
    ? fail("rate_limit_unavailable", "ระบบป้องกันคำขอไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่", 503)
    : fail("rate_limited", "กรุณารอสักครู่แล้วลองใหม่", 429);
  if (result.retryAfterSeconds > 0) response.headers.set("retry-after", String(result.retryAfterSeconds));
  response.headers.set("x-ratelimit-limit", String(result.limit));
  response.headers.set("x-ratelimit-remaining", String(result.remaining));
  return response;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return "Table ordering is unavailable."; }
}
function includesAny(message: string, values: string[]) { const normalized = message.toLowerCase(); return values.some((value) => normalized.includes(value.toLowerCase())); }

function publicError(error: unknown, meta: PublicErrorMeta) {
  const message = getErrorMessage(error);
  const isDev = process.env.NODE_ENV !== "production";
  const logMeta = { method: meta.method, action: meta.action, requestId: meta.requestId, itemCount: meta.itemCount, message };
  if (includesAny(message, ["invalid_qr_token", "qr_session_expired", "QR_SESSION_EXPIRED", "TABLE_SESSION_CLOSED", "table_session_closed", "token_expired", "expired_token"])) return fail("table_order_link_expired", "ลิงก์สั่งอาหารหมดอายุหรือปิดบิลแล้ว", 410);
  if (includesAny(message, ["BUFFET_PLAN_NOT_COMMITTED"])) return fail("buffet_plan_not_committed", "กรุณาให้พนักงานยืนยันแพ็กเกจบุฟเฟ่ลงบิลก่อนเริ่มสั่งอาหารผ่าน QR", 409);
  if (includesAny(message, ["BUFFET_SET_INVALID_ITEM"])) return fail("buffet_set_invalid_item", "การตั้งค่าชุดบุฟเฟ่มีรายการที่ไม่ใช่อาหารบุฟเฟ่ราคา 0 บาท กรุณาติดต่อพนักงาน", 409);
  if (includesAny(message, ["buffet_access_ambiguous"])) return fail("buffet_access_ambiguous", "โต๊ะนี้มีข้อมูลแพ็กเกจบุฟเฟ่ไม่ชัดเจน กรุณาติดต่อพนักงาน", 409);
  if (includesAny(message, ["BUFFET_PRICE_PLAN_QR_FORBIDDEN", "BUFFET_ACCESS_REQUIRED", "BUFFET_SET_ITEM_NOT_INCLUDED"])) return fail("buffet_item_not_allowed", "รายการนี้ไม่อยู่ในแพ็กเกจบุฟเฟ่ของโต๊ะ กรุณาโหลดเมนูใหม่", 422);
  if (includesAny(message, ["FOOD_ORDER_REQUIRED_BEFORE_CHECKOUT", "food_order_required_before_checkout"])) return fail("food_order_required_before_checkout", "กรุณาส่งรายการอาหารก่อนแจ้งชำระบิล", 409);
  if (includesAny(message, ["lock timeout", "canceling statement due to lock timeout", "deadlock detected", "could not serialize access due to concurrent update"])) {
    console.warn("[table-order-api] transient contention; client may retry", logMeta);
    const response = fail("table_order_busy", "มีรายการของโต๊ะนี้กำลังประมวลผลอยู่ กรุณารอสักครู่แล้วลองอีกครั้ง", 409);
    response.headers.set("retry-after", "1");
    return response;
  }
  if (includesAny(message, ["table_order_not_available", "ORDER_NOT_QUEUED", "order_not_queued", "ORDER_NOT_APPENDABLE", "order_not_appendable", "ORDER_NOT_FOUND", "order_not_found", "TABLE_BILL_NOT_OPEN", "table_bill_not_open", "BILL_NOT_OPEN", "bill_not_open", "pending_payment", "closed", "cancelled"])) return fail("table_order_not_available", "โต๊ะนี้ไม่สามารถสั่งอาหารเพิ่มได้แล้ว อาจกำลังรอชำระเงินหรือปิดบิลแล้ว กรุณาติดต่อพนักงาน", 409);
  if (includesAny(message, ["SHIFT_NOT_OPEN", "shift_not_open", "active_shift_not_found", "no_open_shift"])) return fail("shift_not_open", "ร้านยังไม่พร้อมรับรายการในขณะนี้", 409);
  if (includesAny(message, ["PRODUCT_NOT_AVAILABLE", "product_unavailable", "product_not_found", "product_inactive", "INSUFFICIENT_STOCK", "insufficient_stock"])) return fail("insufficient_stock", "มีเมนูที่สต๊อกไม่เพียงพอ กรุณาโหลดเมนูใหม่", 409);
  if (includesAny(message, ["TOO_MANY_CUSTOMER_INGREDIENTS"])) return fail("too_many_toppings", "เลือกท็อปปิ้งได้สูงสุดตามจำนวนที่ร้านกำหนด", 422);
  if (includesAny(message, ["INVALID_CUSTOMER_INGREDIENT_SELECTION", "CUSTOMER_INGREDIENT_SELECTION_NOT_ALLOWED"])) return fail("invalid_toppings", "รายการท็อปปิ้งไม่ถูกต้อง กรุณาโหลดเมนูใหม่แล้วเลือกอีกครั้ง", 422);
  if (includesAny(message, ["INVALID_ITEM", "ITEMS_REQUIRED", "invalid_items", "invalid_order_items"])) return fail("invalid_items", "กรุณาเลือกรายการอาหารให้ถูกต้อง", 422);
  if (includesAny(message, ["submit_table_qr_order_tx", "could not find", "schema cache", "function", "PGRST202", "rpc"])) {
    console.error("[table-order-api] public table order failed", logMeta);
    return fail("table_order_rpc_failed", isDev ? message : "ระบบส่งรายการอาหารยังไม่พร้อมใช้งาน กรุณาติดต่อพนักงาน", 500);
  }
  console.error("[table-order-api] public table order failed", logMeta);
  return fail("table_order_failed", isDev ? message : "ไม่สามารถส่งรายการได้ กรุณาลองใหม่หรือติดต่อพนักงาน", 500);
}

function normalizeAction(body: SubmitPayload) { return body.action ?? body.event_type ?? "order"; }
function normalizeItems(body: SubmitPayload) {
  return (body.items ?? []).map((item) => ({
    product_id: String(item.product_id ?? "").trim(),
    quantity: Number(item.quantity),
    note: typeof item.note === "string" ? item.note.trim().slice(0, 240) : null,
    selected_ingredient_ids: Array.isArray(item.selected_ingredient_ids)
      ? Array.from(new Set(item.selected_ingredient_ids.map((value) => String(value ?? "").trim()).filter(Boolean))).slice(0, TABLE_ORDER_MAX_RAW_INGREDIENT_SELECTIONS)
      : []
  }));
}

async function loadCustomerIngredientSelectionMaxMap(args: { tenantId: string; branchId: string; productIds: string[] }) {
  const result = new Map<string, number>();
  if (!args.productIds.length) return result;
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select("id,customer_ingredient_selection_max")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .in("id", args.productIds);
  if (error) {
    console.warn("[table-order-api] customer ingredient max lookup unavailable; using legacy unlimited behavior", { message: error.message });
    return result;
  }
  for (const row of data ?? []) {
    const id = String(row.id ?? "").trim();
    const rawMax = Number((row as { customer_ingredient_selection_max?: unknown }).customer_ingredient_selection_max ?? 0);
    if (id && Number.isFinite(rawMax) && rawMax > 0) result.set(id, Math.trunc(rawMax));
  }
  return result;
}

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  let token = "";
  const startedAt = Date.now();
  try {
    token = (await context.params).token;
    const url = new URL(request.url);
    const wantsStatus = url.searchParams.get("view") === "status" || url.searchParams.get("state") === "1";
    const rateLimit = await checkRateLimit(request, token, wantsStatus ? "status" : "menu");
    if (!rateLimit.ok) return rateLimitFailure(rateLimit);
    const data = await withTimeout((async () => {
      const qrContext = await resolveTableQrContext(token);
      if (wantsStatus) return loadTableQrState(qrContext);
      const menu = await loadTableQrMenu(qrContext);
      const buffetMenu = await filterTableQrMenuForBuffet({ context: qrContext, products: menu.products });
      const productIds = buffetMenu.products.map((product) => product.id);
      const [states, mediaMap, selectionMaxMap] = await Promise.all([
        loadTableQrStockStates({ tenantId: qrContext.tenant_id, branchId: qrContext.branch_id, productIds }),
        loadProductMediaMap({ tenantId: qrContext.tenant_id, branchId: qrContext.branch_id, productIds }).catch((error) => {
          console.error("[table-order-api] product media lookup failed; continuing without images", error);
          return new Map();
        }),
        loadCustomerIngredientSelectionMaxMap({ tenantId: qrContext.tenant_id, branchId: qrContext.branch_id, productIds })
      ]);
      return {
        ...menu,
        buffet: buffetMenu.buffet,
        categories: Array.from(new Set(buffetMenu.products.map((product) => product.category).filter(Boolean))),
        products: buffetMenu.products.map((product) => {
          const media = mediaMap.get(product.id);
          return {
            ...product,
            customer_ingredient_selection_max: selectionMaxMap.get(product.id) ?? 0,
            ...(states.get(product.id) ?? { stock_on_hand_units: null, allow_negative_stock: false, is_available: true, is_low_stock: false }),
            image_url: media?.image_url ?? null,
            thumbnail_url: media?.thumbnail_url ?? null
          };
        })
      };
    })(), TABLE_ORDER_GET_TIMEOUT_MS, "table_order_menu_timeout");
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
    token = (await context.params).token;
    const rateLimit = await checkRateLimit(request, token, "write");
    if (!rateLimit.ok) return rateLimitFailure(rateLimit);
    const body = (await request.json().catch(() => null)) as SubmitPayload | null;
    if (!body || typeof body !== "object") return fail("invalid_payload", "Invalid request body.", 422);
    action = normalizeAction(body);
    requestId = String(body.request_id ?? request.headers.get("x-idempotency-key") ?? "").trim();
    const clientId = getTableOrderClientId(request);
    if (!requestId || requestId.length > 120) return fail("invalid_request_id", "Invalid request id.", 422);

    if (action === "call_staff" || action === "request_checkout") {
      const qrContext = await resolveTableQrContext(token);
      const result = await submitTableQrServiceRequest({ context: qrContext, requestId, requestType: action, note: typeof body.note === "string" ? body.note.trim().slice(0, 500) : null });
      return ok({ submission_id: result.submission_id, table_code: qrContext.table_code, action, duplicate_request: result.duplicate_request }, result.duplicate_request ? 200 : 201);
    }
    if (action === "update_order") return fail("table_order_locked_after_submit", "รายการที่ยืนยันแล้วแก้ไขหรือลบจากมือถือไม่ได้ กรุณาเรียกพนักงาน", 409);
    if (action !== "order") return fail("invalid_action", "Invalid action.", 422);

    const rawItems = body.items ?? [];
    if (rawItems.some((item) => item.selected_ingredient_ids !== undefined && !Array.isArray(item.selected_ingredient_ids))) {
      return fail("invalid_toppings", "รายการท็อปปิ้งไม่ถูกต้อง กรุณาโหลดเมนูใหม่แล้วเลือกอีกครั้ง", 422);
    }
    if (rawItems.some((item) => Array.isArray(item.selected_ingredient_ids) && item.selected_ingredient_ids.length > TABLE_ORDER_MAX_RAW_INGREDIENT_SELECTIONS)) {
      return fail("invalid_toppings", "รายการท็อปปิ้งมากเกินไป กรุณาโหลดเมนูใหม่แล้วเลือกอีกครั้ง", 422);
    }

    const items = normalizeItems(body);
    itemCount = items.length;
    if (items.length < 1 || items.length > 50) return fail("invalid_items", "กรุณาเลือกเมนู 1-50 รายการ", 422);
    if (items.some((item) => !item.product_id || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)) return fail("invalid_items", "จำนวนอาหารไม่ถูกต้อง", 422);

    const qrContext = await resolveTableQrContext(token);
    await assertTableQrBuffetItemsAllowed({ context: qrContext, items });
    await assertTableQrStockAvailable({ tenantId: qrContext.tenant_id, branchId: qrContext.branch_id, items });
    const result = await submitTableQrOrder({ context: qrContext, requestId, items, note: typeof body.note === "string" ? body.note.trim().slice(0, 500) : null, clientId });
    return ok({ submission_id: result.submission_id, order_no: result.order_no, table_code: qrContext.table_code, subtotal: Number(result.subtotal), tax_total: Number(result.tax_total), grand_total: Number(result.grand_total), duplicate_request: result.duplicate_request, review_status: result.review_status ?? null, kitchen_pending_review: result.kitchen_pending_review === true }, result.duplicate_request ? 200 : 201);
  } catch (error) {
    return publicError(error, { method: "POST", token, action, requestId, itemCount });
  }
}
