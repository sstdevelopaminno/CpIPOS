import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { fail, ok } from "@/lib/http";
import { buildPaginationMeta, parsePagination } from "@/lib/query-params";
import { loadReceiptStoreProfile } from "@/lib/services/store-profile-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

function toBangkokDate(value: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(value);
}

function resolveDateWindow(searchParams: URLSearchParams) {
  const mode = searchParams.get("mode") ?? "day";
  const now = new Date();
  const today = toBangkokDate(now);
  const date = searchParams.get("date") || today;
  const month = searchParams.get("month") || today.slice(0, 7);
  const year = searchParams.get("year") || today.slice(0, 4);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (mode === "month") {
    const [y, m] = month.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1, -7, 0, 0));
    const end = new Date(Date.UTC(y, m, 1, -7, 0, 0));
    return { gte: start.toISOString(), lt: end.toISOString(), label: month };
  }

  if (mode === "year") {
    const y = Number(year);
    const start = new Date(Date.UTC(y, 0, 1, -7, 0, 0));
    const end = new Date(Date.UTC(y + 1, 0, 1, -7, 0, 0));
    return { gte: start.toISOString(), lt: end.toISOString(), label: year };
  }

  if (mode === "custom" && from && to) {
    const start = new Date(`${from}T00:00:00+07:00`);
    const end = new Date(`${to}T00:00:00+07:00`);
    end.setDate(end.getDate() + 1);
    return { gte: start.toISOString(), lt: end.toISOString(), label: `${from} - ${to}` };
  }

  const start = new Date(`${date}T00:00:00+07:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { gte: start.toISOString(), lt: end.toISOString(), label: date };
}

function readMetadataString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readMetadataArray(metadata: unknown, key: string): unknown[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const value = (metadata as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : [];
}

export async function GET(req: Request) {
  const startedAt = Date.now();
  const withTiming = (response: Response) => {
    response.headers.set("x-pos-receipts-ms", String(Date.now() - startedAt));
    return response;
  };

  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "receipts:view" });
    await requirePosApiFeature(auth, "receipt_reprint_history");
    const supabase = getSupabaseServiceClient();
    const { searchParams } = new URL(req.url);
    const { page, pageSize } = parsePagination(searchParams, 20);
    const fromIndex = (page - 1) * pageSize;
    const toIndex = fromIndex + pageSize - 1;
    const status = searchParams.get("status")?.trim() || "completed";
    const q = searchParams.get("q")?.trim();
    const dateWindow = resolveDateWindow(searchParams);

    let query = supabase
      .from("orders")
      .select(
        "id,order_no,order_type,channel,table_id,customer_name,external_order_code,subtotal,discount_amount,gp_amount,total_amount,grand_total,paid_total,tax_total,status,created_at,created_by,payment_completed_at,payment_completed_by,cash_received,change_amount,notes,metadata",
        { count: "exact" }
      )
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .gte("created_at", dateWindow.gte)
      .lt("created_at", dateWindow.lt)
      .order("created_at", { ascending: false })
      .range(fromIndex, toIndex);

    if (status !== "all") {
      query = query.eq("status", status);
    }
    if (q) {
      query = query.or(`order_no.ilike.%${q}%,customer_name.ilike.%${q}%,external_order_code.ilike.%${q}%`);
    }

    const { data: orders, error: ordersError, count } = await query;
    if (ordersError) {
      return withTiming(fail("receipt_orders_query_failed", ordersError.message, 500));
    }

    const rows = (orders ?? []) as Array<{
      id: string;
      order_no: string;
      order_type: string;
      channel: string;
      table_id: string | null;
      customer_name: string | null;
      external_order_code: string | null;
      subtotal: number | null;
      discount_amount: number | null;
      gp_amount: number | null;
      total_amount: number | null;
      grand_total: number | null;
      paid_total: number | null;
      tax_total: number | null;
      status: string;
      created_at: string;
      created_by: string | null;
      payment_completed_at: string | null;
      payment_completed_by: string | null;
      cash_received: number | null;
      change_amount: number | null;
      notes: string | null;
      metadata: unknown;
    }>;

    const orderIds = rows.map((row) => row.id);
    const userIds = Array.from(new Set(rows.flatMap((row) => [row.created_by, row.payment_completed_by]).filter((id): id is string => Boolean(id))));
    const tableIds = Array.from(new Set(rows.map((row) => row.table_id).filter((id): id is string => Boolean(id))));

    const [paymentsResult, itemsResult, usersResult, tablesResult, branchResult, storeProfile] = await Promise.all([
      orderIds.length > 0
        ? supabase
            .from("payments")
            .select("order_id,method,amount,status,created_at")
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", auth.branchId!)
            .in("order_id", orderIds)
            .gt("quantity", 0)
        : Promise.resolve({ data: [], error: null }),
      orderIds.length > 0
        ? supabase
            .from("order_items")
            .select("order_id,product_id,name,quantity,unit_price,line_total,notes")
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", auth.branchId!)
            .in("order_id", orderIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length > 0
        ? supabase.from("users_profiles").select("id,full_name").in("id", userIds)
        : Promise.resolve({ data: [], error: null }),
      tableIds.length > 0
        ? supabase.from("dining_tables").select("id,table_code,table_name").eq("tenant_id", auth.tenantId!).in("id", tableIds)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("branches").select("name").eq("tenant_id", auth.tenantId!).eq("id", auth.branchId!).maybeSingle(),
      loadReceiptStoreProfile(auth.tenantId!)
    ]);

    if (paymentsResult.error) return withTiming(fail("receipt_payments_query_failed", paymentsResult.error.message, 500));
    if (itemsResult.error) return withTiming(fail("receipt_items_query_failed", itemsResult.error.message, 500));
    if (usersResult.error) return withTiming(fail("receipt_users_query_failed", usersResult.error.message, 500));
    if (tablesResult.error) return withTiming(fail("receipt_tables_query_failed", tablesResult.error.message, 500));
    if (branchResult.error) return withTiming(fail("receipt_branch_query_failed", branchResult.error.message, 500));

    const productIds = Array.from(
      new Set((itemsResult.data ?? []).map((item) => String(item.product_id ?? "")).filter(Boolean))
    );
    let productRows: Array<{ id: string; sku?: string | null; name?: string | null }> = [];
    let productError: { message?: string | null; details?: string | null } | null = null;

    if (productIds.length > 0) {
      const result = await supabase
        .from("products")
        .select("id,sku,name")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .in("id", productIds);
      productRows = (result.data ?? []) as Array<{ id: string; sku?: string | null; name?: string | null }>;
      productError = result.error;
    }

    if (productError) {
      const productErrorText = `${productError.message ?? ""} ${productError.details ?? ""}`.toLowerCase();
      if (productErrorText.includes("products.sku") || productErrorText.includes("'sku'") || productErrorText.includes("\"sku\"")) {
        const fallbackResult = await supabase
          .from("products")
          .select("id,name")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .in("id", productIds);
        productRows = (fallbackResult.data ?? []) as Array<{ id: string; name?: string | null }>;
        productError = fallbackResult.error;
      }
    }

    if (productError) return withTiming(fail("receipt_products_query_failed", productError.message ?? "Product query failed.", 500));

    const userMap = new Map((usersResult.data ?? []).map((row) => [String(row.id), String(row.full_name ?? row.id)]));
    const productMap = new Map(
      productRows.map((row) => [
        String(row.id),
        {
          code: String(row.sku ?? row.id),
          name: String(row.name ?? row.id)
        }
      ])
    );
    const tableMap = new Map(
      (tablesResult.data ?? []).map((row) => [String(row.id), String(row.table_name || row.table_code || row.id)])
    );
    const paymentsByOrder = new Map<string, Array<{ method: string; amount: number; status?: string | null; created_at?: string | null }>>();
    for (const payment of paymentsResult.data ?? []) {
      const key = String(payment.order_id);
      const list = paymentsByOrder.get(key) ?? [];
      list.push({
        method: String(payment.method ?? ""),
        amount: Number(payment.amount ?? 0),
        status: payment.status == null ? null : String(payment.status),
        created_at: payment.created_at == null ? null : String(payment.created_at)
      });
      paymentsByOrder.set(key, list);
    }

    const itemsByOrder = new Map<
      string,
      Array<{
        product_id: string;
        product_code: string;
        name: string;
        quantity: number;
        unit_price: number;
        line_total: number;
        notes: string | null;
      }>
    >();
    for (const item of itemsResult.data ?? []) {
      const key = String(item.order_id);
      const list = itemsByOrder.get(key) ?? [];
      const productId = String(item.product_id ?? "");
      const product = productMap.get(productId);
      const itemName = String(item.name ?? "");
      const nameLooksLikeId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemName);
      list.push({
        product_id: productId,
        product_code: product?.code ?? productId,
        name: nameLooksLikeId || !itemName ? product?.name ?? productId : itemName,
        quantity: Number(item.quantity ?? 0),
        unit_price: Number(item.unit_price ?? 0),
        line_total: Number(item.line_total ?? 0),
        notes: item.notes == null ? null : String(item.notes)
      });
      itemsByOrder.set(key, list);
    }

    const records = rows.map((row) => {
      const payments = paymentsByOrder.get(row.id) ?? [];
      const items = itemsByOrder.get(row.id) ?? [];
      const paidTotal = payments.reduce((sum, payment) => sum + payment.amount, 0);
      const total = Number(row.grand_total ?? row.total_amount ?? 0);
      const memberName = readMetadataString(row.metadata, "member_name");
      const memberPhone = readMetadataString(row.metadata, "member_phone");
      return {
        id: row.id,
        orderNo: row.order_no,
        orderType: row.order_type,
        channel: row.channel,
        tableLabel: row.table_id ? tableMap.get(row.table_id) ?? "-" : "-",
        customerName: row.customer_name ?? "-",
        memberName,
        memberPhone,
        externalOrderCode: row.external_order_code ?? null,
        subtotal: Number(row.subtotal ?? 0),
        discountAmount: Number(row.discount_amount ?? 0),
        gpAmount: Number(row.gp_amount ?? 0),
        taxTotal: Number(row.tax_total ?? 0),
        taxLines: readMetadataArray(row.metadata, "tax_lines"),
        totalAmount: total,
        paidTotal: Number(row.paid_total ?? paidTotal),
        status: row.status,
        createdAt: row.created_at,
        paidAt: row.payment_completed_at ?? payments[0]?.created_at ?? null,
        cashierName: row.payment_completed_by ? userMap.get(row.payment_completed_by) ?? row.payment_completed_by : "-",
        sellerName: row.created_by ? userMap.get(row.created_by) ?? row.created_by : "-",
        paymentMethods: payments.map((payment) => payment.method),
        itemCount: items.length,
        items,
        cashReceived: Number(row.cash_received ?? 0),
        changeAmount: Number(row.change_amount ?? 0),
        notes: row.notes ?? null
      };
    });

    const completed = records.filter((record) => record.status === "completed");
    const summary = {
      receiptCount: records.length,
      completedCount: completed.length,
      grossTotal: records.reduce((sum, row) => sum + row.totalAmount, 0),
      paidTotal: records.reduce((sum, row) => sum + row.paidTotal, 0)
    };

    return withTiming(ok({
      branch: { id: auth.branchId, name: String(branchResult.data?.name ?? auth.branchId), store_profile: storeProfile },
      range: dateWindow,
      records,
      summary,
      pagination: buildPaginationMeta(page, pageSize, count)
    }));
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return withTiming(featureError);
    return withTiming(fail("unauthorized", error instanceof Error ? error.message : "Authentication failed.", 401));
  }
}
