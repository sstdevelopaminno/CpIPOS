import { createServiceClient } from "@/lib/supabase/server";

type MobileScope = {
  tenantId: string;
  branchId: string;
  sessionId: string;
  userId: string;
  deviceCode: string;
};

export type DineInCartInput = {
  orderId: string;
  discountMode?: "percent" | "amount";
  discountValue?: number;
  items: Array<{
    productId: string;
    quantity: number;
  }>;
};

type DraftOrderRow = {
  id: string;
  order_no: string;
  shift_id: string | null;
  table_id: string | null;
  metadata: Record<string, unknown> | null;
};

type ProductRow = {
  id: string;
  name: string | null;
  price: number | null;
};

type ActiveTableSessionRow = {
  id: string;
  status: string | null;
  order_id: string | null;
  metadata: Record<string, unknown> | null;
};

function dbPaymentMethod(method: "cash" | "transfer") {
  return method === "transfer" ? "bank_transfer" : "cash";
}

async function requireActiveTableSessionForOrder(
  supabase: ReturnType<typeof createServiceClient>,
  scope: MobileScope,
  draft: DraftOrderRow,
) {
  if (!draft.table_id) throw new Error("draft_order_not_found");

  const sessionId = typeof draft.metadata?.table_session_id === "string" ? draft.metadata.table_session_id : null;
  let query = supabase
    .from("table_bill_sessions")
    .select("id,status,order_id,metadata")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .in("status", ["open", "ordering", "pending_payment"]);

  query = sessionId ? query.eq("id", sessionId) : query.eq("table_id", draft.table_id);

  const { data, error } = await query
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle<ActiveTableSessionRow>();
  if (error) throw new Error(error.message);
  if (!data || data.order_id !== draft.id) throw new Error("table_session_not_active");

  return data;
}

export async function saveDineInDraft(
  supabase: ReturnType<typeof createServiceClient>,
  scope: MobileScope,
  input: DineInCartInput,
  metadata: Record<string, unknown>,
) {
  const { data: draft, error: draftError } = await supabase
    .from("orders")
    .select("id,order_no,shift_id,table_id,metadata")
    .eq("id", input.orderId)
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("order_type", "dine_in")
    .eq("status", "draft")
    .maybeSingle<DraftOrderRow>();
  if (draftError) throw new Error(draftError.message);
  if (!draft?.table_id) throw new Error("draft_order_not_found");
  const activeSession = await requireActiveTableSessionForOrder(supabase, scope, draft);

  const productIds = Array.from(new Set(input.items.map((item) => item.productId)));
  if (!productIds.length) throw new Error("empty_cart");

  const { data: products, error: productError } = await supabase
    .from("products")
    .select("id,name,price")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("is_active", true)
    .in("id", productIds);
  if (productError) throw new Error(productError.message);

  const productsById = new Map(((products ?? []) as ProductRow[]).map((product) => [product.id, product]));
  if (productsById.size !== productIds.length) throw new Error("product_not_available");

  const lines = input.items.map((item) => {
    const product = productsById.get(item.productId);
    if (!product) throw new Error("product_not_available");
    const quantity = Math.max(1, Math.trunc(Number(item.quantity)));
    const unitPrice = Number(product.price ?? 0);
    return {
      productId: item.productId,
      name: product.name ?? "-",
      quantity,
      unitPrice,
      lineTotal: quantity * unitPrice,
    };
  });

  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const discountValue = Math.max(0, Number(input.discountValue ?? 0));
  const discount = input.discountMode === "percent"
    ? Math.min(subtotal, subtotal * Math.min(discountValue, 100) / 100)
    : Math.min(subtotal, discountValue);
  const total = Math.max(0, subtotal - discount);
  const nowIso = new Date().toISOString();

  const { error: deleteError } = await supabase
    .from("order_items")
    .delete()
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("order_id", draft.id);
  if (deleteError) throw new Error(deleteError.message);

  const { error: itemError } = await supabase.from("order_items").insert(lines.map((line) => ({
    tenant_id: scope.tenantId,
    branch_id: scope.branchId,
    order_id: draft.id,
    product_id: line.productId,
    name: line.name,
    quantity: line.quantity,
    unit_price: line.unitPrice,
    line_total: line.lineTotal,
    metadata: { source_app: "CpIPOS Mobile",
          source_channel: "mobile_web", mode: "dine_in" },
  })));
  if (itemError) throw new Error(itemError.message);

  const { error: updateError } = await supabase
    .from("orders")
    .update({
      subtotal,
      discount_amount: discount,
      total_amount: total,
      grand_total: total,
      paid_total: 0,
      updated_at: nowIso,
      metadata: {
        ...(draft.metadata ?? {}),
        source_app: "CpIPOS Mobile",
          source_channel: "mobile_web",
        mode: "dine_in",
        discount_mode: input.discountMode ?? "amount",
        discount_value: input.discountValue ?? 0,
        ...metadata,
      },
    })
    .eq("id", draft.id)
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("status", "draft");
  if (updateError) throw new Error(updateError.message);

  await Promise.allSettled([
    supabase
      .from("table_bill_sessions")
      .update({
        status: "ordering",
        order_id: draft.id,
        metadata: {
          ...(activeSession.metadata ?? {}),
          opened_shift_id: draft.shift_id,
          last_order_id: draft.id,
          last_order_no: draft.order_no,
          source_app: "CpIPOS Mobile",
          source_channel: "mobile_web",
          mode: "dine_in",
        },
      })
      .eq("id", activeSession.id)
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("order_id", draft.id)
      .in("status", ["open", "ordering", "pending_payment"]),
    supabase
      .from("dining_tables")
      .update({ status: "ordering" })
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("id", draft.table_id),
  ]);

  return { orderId: draft.id, orderNo: draft.order_no, shiftId: draft.shift_id, tableId: draft.table_id, total, subtotal, discount, lines };
}

export async function releaseDineInTable(
  supabase: ReturnType<typeof createServiceClient>,
  scope: MobileScope,
  tableId: string,
  status: "closed" | "cancelled",
  orderId?: string,
) {
  const nowIso = new Date().toISOString();
  let sessionQuery = supabase
    .from("table_bill_sessions")
    .update({ status, closed_by: scope.userId, closed_at: nowIso })
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("table_id", tableId)
    .in("status", ["open", "ordering", "pending_payment"]);

  if (orderId) sessionQuery = sessionQuery.eq("order_id", orderId);

  const { data: releasedSessions, error: releaseError } = await sessionQuery.select("id");
  if (releaseError) throw new Error(releaseError.message);
  if (!orderId || (releasedSessions ?? []).length > 0) {
    const { error: tableError } = await supabase
      .from("dining_tables")
      .update({ status: "available" })
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("id", tableId);
    if (tableError) throw new Error(tableError.message);
  }
}

export async function completeDineInPayment(args: {
  supabase: ReturnType<typeof createServiceClient>;
  scope: MobileScope;
  saved: Awaited<ReturnType<typeof saveDineInDraft>>;
  paymentMethod: "cash" | "transfer";
  cashReceived: number | null;
  referenceNo: string | null;
}) {
  const { supabase, scope, saved, paymentMethod, cashReceived, referenceNo } = args;
  if (paymentMethod === "cash" && Number(cashReceived ?? 0) + 0.009 < saved.total) {
    throw new Error("cash_not_enough");
  }

  const { data: latestDraft, error: latestDraftError } = await supabase
    .from("orders")
    .select("id,order_no,shift_id,table_id,metadata")
    .eq("id", saved.orderId)
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("order_type", "dine_in")
    .eq("status", "draft")
    .maybeSingle<DraftOrderRow>();
  if (latestDraftError) throw new Error(latestDraftError.message);
  if (!latestDraft) throw new Error("draft_order_not_found");
  await requireActiveTableSessionForOrder(supabase, scope, latestDraft);

  const { data: existingPayment, error: existingPaymentError } = await supabase
    .from("payments")
    .select("id")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("order_id", saved.orderId)
    .eq("status", "paid")
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (existingPaymentError) throw new Error(existingPaymentError.message);
  if (existingPayment) throw new Error("order_already_paid");

  const requestId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const stockResult = await supabase.rpc("deduct_order_recipe_stock", {
    p_tenant_id: scope.tenantId,
    p_branch_id: scope.branchId,
    p_order_id: saved.orderId,
    p_order_type: "dine_in",
    p_created_by: scope.userId,
    p_reason: "Auto deduction from Mobile dine-in checkout",
    p_request_id: requestId,
  });
  if (stockResult.error) throw new Error(stockResult.error.message);

  const { error: paymentError } = await supabase.from("payments").insert({
    tenant_id: scope.tenantId,
    branch_id: scope.branchId,
    order_id: saved.orderId,
    method: dbPaymentMethod(paymentMethod),
    amount: saved.total,
    reference_no: paymentMethod === "transfer" ? referenceNo : null,
    received_by: scope.userId,
    received_at: nowIso,
    request_group_id: requestId,
    shift_id: saved.shiftId,
    pos_session_id: scope.sessionId,
    status: "paid",
    metadata: { source_app: "CpIPOS Mobile",
          source_channel: "mobile_web", mode: "dine_in", cash_received: paymentMethod === "cash" ? cashReceived : null },
  });
  if (paymentError) throw new Error(paymentError.message);

  const received = paymentMethod === "cash" ? Number(cashReceived ?? 0) : saved.total;
  const { data: completedOrder, error: orderError } = await supabase
    .from("orders")
    .update({
      status: "completed",
      tax_total: 0,
      paid_total: saved.total,
      cash_received: paymentMethod === "cash" ? received : null,
      change_amount: paymentMethod === "cash" ? Math.max(0, received - saved.total) : 0,
      payment_completed_at: nowIso,
      payment_completed_by: scope.userId,
      request_id: requestId,
      updated_at: nowIso,
      metadata: {
        source_app: "CpIPOS Mobile",
          source_channel: "mobile_web",
        mode: "dine_in",
        payment_method: dbPaymentMethod(paymentMethod),
      },
    })
    .eq("id", saved.orderId)
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle<{ id: string }>();
  if (orderError) throw new Error(orderError.message);
  if (!completedOrder) throw new Error("draft_order_not_found");

  await releaseDineInTable(supabase, scope, saved.tableId, "closed", saved.orderId);
}


