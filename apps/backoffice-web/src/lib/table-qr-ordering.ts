import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import QRCode from "qrcode";
import type { AuthContext } from "@/lib/auth-context";
import { readRequiredEnv } from "@/lib/env";
import { enqueueKitchenTicketForOrderSnapshot } from "@/lib/printing/print-service";
import { loadReceiptStoreProfile } from "@/lib/services/store-profile-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

const ACTIVE_TABLE_STATUSES = ["open", "ordering", "pending_payment"];
const DEFAULT_QR_TTL_HOURS = 18;

type QrSessionRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  table_id: string;
  table_session_id: string;
  status: "active" | "revoked" | "expired";
  expires_at: string;
  created_by: string;
};

type QrContext = QrSessionRow & {
  table_code: string;
  table_name: string | null;
  branch_name: string;
  store_name: string;
};

type SubmitQrOrderRow = {
  submission_id: string;
  order_id: string;
  order_no: string;
  table_id: string;
  table_session_id: string;
  subtotal: number;
  tax_total: number;
  grand_total: number;
  duplicate_request: boolean;
};

type TableQrServiceRequestType = "call_staff" | "request_checkout";

type TableQrMenuProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
};

type TableQrMenuCacheEntry = {
  expiresAt: number;
  products: TableQrMenuProduct[];
};

const TABLE_QR_MENU_CACHE_TTL_MS = 60_000;
const tableQrMenuCache = new Map<string, TableQrMenuCacheEntry>();

function readTableQrMenuCache(tenantId: string, branchId: string): TableQrMenuProduct[] | null {
  const key = `${tenantId}:${branchId}`;
  const entry = tableQrMenuCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    tableQrMenuCache.delete(key);
    return null;
  }
  return entry.products;
}

function writeTableQrMenuCache(tenantId: string, branchId: string, products: TableQrMenuProduct[]) {
  tableQrMenuCache.set(`${tenantId}:${branchId}`, {
    expiresAt: Date.now() + TABLE_QR_MENU_CACHE_TTL_MS,
    products
  });
}

function signingSecret(): string {
  return readRequiredEnv("TABLE_QR_SIGNING_SECRET", "table_qr_signing_secret_missing");
}

function signatureFor(sessionId: string, secret = signingSecret()): string {
  return createHmac("sha256", secret).update(`table-order:${sessionId}`).digest("base64url");
}

export function buildTableQrToken(sessionId: string): string {
  return `${sessionId}.${signatureFor(sessionId)}`;
}

export function parseAndVerifyTableQrToken(token: string): string | null {
  const [sessionId, signature, extra] = token.split(".");
  if (!sessionId || !signature || extra) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) return null;
  const expected = signatureFor(sessionId);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  return timingSafeEqual(actualBuffer, expectedBuffer) ? sessionId : null;
}

export async function issueTableQrSession(args: {
  auth: AuthContext;
  tableId: string;
  requestOrigin: string;
}) {
  const { auth, tableId, requestOrigin } = args;
  if (!auth.tenantId || !auth.branchId) throw new Error("missing_scope");
  const secret = signingSecret();
  const supabase = getSupabaseServiceClient();

  const [{ data: table, error: tableError }, { data: tableSession, error: sessionError }] = await Promise.all([
    supabase
      .from("dining_tables")
      .select("id,table_code,table_name,status,is_active")
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .eq("id", tableId)
      .maybeSingle<{ id: string; table_code: string; table_name: string | null; status: string; is_active: boolean }>(),
    supabase
      .from("table_bill_sessions")
      .select("id,tenant_id,branch_id,table_id,status,opened_by")
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .eq("table_id", tableId)
      .in("status", ACTIVE_TABLE_STATUSES)
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; tenant_id: string; branch_id: string; table_id: string; status: string; opened_by: string }>()
  ]);

  if (tableError) throw new Error(tableError.message);
  if (sessionError) throw new Error(sessionError.message);
  if (!table || !table.is_active || !["occupied", "ordering", "pending_payment"].includes(table.status)) {
    throw new Error("table_not_open");
  }
  if (!tableSession) throw new Error("table_session_not_open");

  const expiresAt = new Date(Date.now() + DEFAULT_QR_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const { data: existing } = await supabase
    .from("table_qr_sessions")
    .select("id,tenant_id,branch_id,table_id,table_session_id,status,expires_at,created_by")
    .eq("tenant_id", auth.tenantId)
    .eq("branch_id", auth.branchId)
    .eq("table_session_id", tableSession.id)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle<QrSessionRow>();

  let qrSession = existing;
  if (!qrSession) {
    await supabase
      .from("table_qr_sessions")
      .update({ status: "expired" })
      .eq("tenant_id", auth.tenantId)
      .eq("branch_id", auth.branchId)
      .eq("table_session_id", tableSession.id)
      .eq("status", "active");

    const { data: created, error: createError } = await supabase
      .from("table_qr_sessions")
      .insert({
        tenant_id: auth.tenantId,
        branch_id: auth.branchId,
        table_id: tableId,
        table_session_id: tableSession.id,
        status: "active",
        expires_at: expiresAt,
        created_by: auth.userId
      })
      .select("id,tenant_id,branch_id,table_id,table_session_id,status,expires_at,created_by")
      .single<QrSessionRow>();
    if (createError) throw new Error(createError.message);
    qrSession = created;
  }

  const token = `${qrSession.id}.${signatureFor(qrSession.id, secret)}`;
  const orderUrl = `${requestOrigin.replace(/\/$/, "")}/table-order/${encodeURIComponent(token)}`;
  const qrDataUrl = await QRCode.toDataURL(orderUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 420,
    color: { dark: "#000000", light: "#ffffff" }
  });

  return {
    qr_session_id: qrSession.id,
    table_session_id: tableSession.id,
    table_id: table.id,
    table_code: table.table_code,
    table_name: table.table_name,
    order_url: orderUrl,
    qr_data_url: qrDataUrl,
    expires_at: qrSession.expires_at
  };
}

export async function resolveTableQrContext(token: string): Promise<QrContext> {
  const qrSessionId = parseAndVerifyTableQrToken(token);
  if (!qrSessionId) throw new Error("invalid_qr_token");
  const supabase = getSupabaseServiceClient();
  const { data: qr, error: qrError } = await supabase
    .from("table_qr_sessions")
    .select("id,tenant_id,branch_id,table_id,table_session_id,status,expires_at,created_by")
    .eq("id", qrSessionId)
    .maybeSingle<QrSessionRow>();
  if (qrError) throw new Error(qrError.message);
  if (!qr || qr.status !== "active" || new Date(qr.expires_at).getTime() <= Date.now()) {
    throw new Error("qr_session_expired");
  }

  const [{ data: tableSession }, { data: table }, { data: branch }, store] = await Promise.all([
    supabase
      .from("table_bill_sessions")
      .select("id,status,closed_at")
      .eq("id", qr.table_session_id)
      .eq("tenant_id", qr.tenant_id)
      .eq("branch_id", qr.branch_id)
      .eq("table_id", qr.table_id)
      .maybeSingle<{ id: string; status: string; closed_at: string | null }>(),
    supabase
      .from("dining_tables")
      .select("id,table_code,table_name,status,is_active")
      .eq("id", qr.table_id)
      .eq("tenant_id", qr.tenant_id)
      .eq("branch_id", qr.branch_id)
      .maybeSingle<{ id: string; table_code: string; table_name: string | null; status: string; is_active: boolean }>(),
    supabase
      .from("branches")
      .select("name")
      .eq("id", qr.branch_id)
      .eq("tenant_id", qr.tenant_id)
      .maybeSingle<{ name: string | null }>(),
    loadReceiptStoreProfile(qr.tenant_id)
  ]);

  if (!tableSession || !ACTIVE_TABLE_STATUSES.includes(tableSession.status) || tableSession.closed_at) {
    throw new Error("table_session_closed");
  }
  if (!table || !table.is_active || !["occupied", "ordering", "pending_payment"].includes(table.status)) {
    throw new Error("table_not_available");
  }

  return {
    ...qr,
    table_code: table.table_code,
    table_name: table.table_name,
    branch_name: branch?.name?.trim() || "Branch",
    store_name: store?.display_name?.trim() || store?.name?.trim() || "CpIPOS"
  };
}

export async function loadTableQrMenu(context: QrContext) {
  const supabase = getSupabaseServiceClient();
  const hasSubmittedFoodOrder = await hasSubmittedFoodOrderForContext(context, supabase);
  const cachedProducts = readTableQrMenuCache(context.tenant_id, context.branch_id);
  if (cachedProducts) {
    return {
      store_name: context.store_name,
      branch_name: context.branch_name,
      table_code: context.table_code,
      table_name: context.table_name,
      expires_at: context.expires_at,
      categories: Array.from(new Set(cachedProducts.map((product) => product.category))),
      products: cachedProducts,
      has_submitted_food_order: hasSubmittedFoodOrder
    };
  }

  const { data, error } = await supabase
    .from("products")
    .select("id,name,category,price,is_active")
    .eq("tenant_id", context.tenant_id)
    .eq("branch_id", context.branch_id)
    .eq("is_active", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);

  const products = (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
    category: String(row.category ?? "เมนู"),
    price: Number(row.price ?? 0)
  }));
  writeTableQrMenuCache(context.tenant_id, context.branch_id, products);
  return {
    store_name: context.store_name,
    branch_name: context.branch_name,
    table_code: context.table_code,
    table_name: context.table_name,
    expires_at: context.expires_at,
    categories: Array.from(new Set(products.map((product) => product.category))),
    products,
    has_submitted_food_order: hasSubmittedFoodOrder
  };
}

export async function hasSubmittedFoodOrderForContext(context: QrContext, supabase = getSupabaseServiceClient()) {
  const { data, error } = await supabase
    .from("table_qr_orders")
    .select("id")
    .eq("tenant_id", context.tenant_id)
    .eq("branch_id", context.branch_id)
    .eq("table_session_id", context.table_session_id)
    .eq("event_type", "order")
    .gt("item_count", 0)
    .limit(1);

  if (error) throw new Error(error.message);
  return Boolean(data?.length);
}

export async function submitTableQrOrder(args: {
  context: QrContext;
  requestId: string;
  items: Array<{ product_id: string; quantity: number; note?: string | null }>;
  note?: string | null;
}) {
  const { context, requestId, items, note } = args;
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("submit_table_qr_order_tx", {
    p_qr_session_id: context.id,
    p_request_id: requestId,
    p_items: items,
    p_note: note ?? null
  });
  if (error) throw new Error(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as SubmitQrOrderRow | null;
  if (!row) throw new Error("table_qr_order_failed");

  if (!row.duplicate_request) {
    const productIds = items.map((item) => item.product_id);
    const { data: productRows } = await supabase
      .from("products")
      .select("id,name,price")
      .eq("tenant_id", context.tenant_id)
      .eq("branch_id", context.branch_id)
      .in("id", productIds);
    const productMap = new Map((productRows ?? []).map((product) => [String(product.id), product]));
    const printItems = items.map((item) => {
      const product = productMap.get(item.product_id);
      const unitPrice = Number(product?.price ?? 0);
      return {
        product_name: String(product?.name ?? "Item"),
        quantity: item.quantity,
        unit_price: unitPrice,
        line_total: Number((unitPrice * item.quantity).toFixed(2)),
        note: item.note ?? null
      };
    });
    const printAuth: AuthContext = {
      userId: context.created_by,
      platformRole: "tenant_user",
      tenantId: context.tenant_id,
      branchId: context.branch_id,
      branchRole: "staff"
    };
    try {
      await enqueueKitchenTicketForOrderSnapshot({
        auth: printAuth,
        order: {
          id: row.order_id,
          order_no: row.order_no
        },
        items: printItems,
        station: `Table ${context.table_code} QR`
      });
    } catch {
      // The order is already committed. Printing can be retried from the POS print queue without duplicating the order.
    }
  }

  return row;
}

export async function submitTableQrServiceRequest(args: {
  context: QrContext;
  requestId: string;
  requestType: TableQrServiceRequestType;
  note?: string | null;
}) {
  const { context, requestId, requestType, note } = args;
  const cleanRequestId = requestId.trim();
  if (!cleanRequestId) throw new Error("REQUEST_ID_REQUIRED");

  const supabase = getSupabaseServiceClient();
  if (requestType === "request_checkout") {
    const hasSubmittedFoodOrder = await hasSubmittedFoodOrderForContext(context, supabase);
    if (!hasSubmittedFoodOrder) throw new Error("FOOD_ORDER_REQUIRED_BEFORE_CHECKOUT");
  }

  const { data: existing, error: existingError } = await supabase
    .from("table_qr_orders")
    .select("id,created_at")
    .eq("qr_session_id", context.id)
    .eq("request_id", cleanRequestId)
    .maybeSingle<{ id: string; created_at: string }>();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    return { submission_id: existing.id, duplicate_request: true };
  }

  const { data, error } = await supabase
    .from("table_qr_orders")
    .insert({
      tenant_id: context.tenant_id,
      branch_id: context.branch_id,
      table_id: context.table_id,
      table_session_id: context.table_session_id,
      qr_session_id: context.id,
      order_id: null,
      request_id: cleanRequestId,
      event_type: requestType,
      item_count: 0,
      subtotal: 0,
      payload: {
        type: requestType,
        note: note?.trim() ? note.trim().slice(0, 500) : null,
        table_code: context.table_code
      }
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(error.message);

  return { submission_id: data.id, duplicate_request: false };
}
