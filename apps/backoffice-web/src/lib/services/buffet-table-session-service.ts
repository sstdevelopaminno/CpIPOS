import "server-only";

import {
  EMPTY_BUFFET_TABLE_SESSION_SUMMARY,
  mergeBuffetTableSessionSummaryMetadata,
  normalizeBuffetTableSessionSummary,
  type BuffetTableSessionSummary
} from "@/lib/buffet-table-session";
import { buffetPlanModeFromProduct } from "@/lib/pos-buffet-plan-product";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type BuffetProductRow = {
  id: string;
  sku: string | null;
  name: string;
  metadata: Record<string, unknown> | null;
};

type BuffetOrderItemRow = {
  product_id: string;
  quantity: number | null;
  line_total: number | null;
};

type ActiveTableSessionRow = {
  id: string;
  table_id: string;
  order_id: string | null;
  metadata: Record<string, unknown> | null;
};

function roundMoney(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toFixed(2));
}

function positiveQuantity(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.max(0, Math.trunc(parsed));
}

async function loadBuffetProducts(tenantId: string, branchId: string) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select("id,sku,name,metadata")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .returns<BuffetProductRow[]>();
  if (error) throw new Error(`buffet_product_query_failed:${error.message}`);
  return (data ?? []).filter((product) => buffetPlanModeFromProduct(product) !== null);
}

export async function deriveBuffetTableSessionSummary(args: {
  tenantId: string;
  branchId: string;
  orderId: string;
}): Promise<BuffetTableSessionSummary> {
  const products = await loadBuffetProducts(args.tenantId, args.branchId);
  if (products.length === 0) return { ...EMPTY_BUFFET_TABLE_SESSION_SUMMARY };

  const modeByProductId = new Map<string, "per_person" | "set">();
  for (const product of products) {
    const mode = buffetPlanModeFromProduct(product);
    if (mode) modeByProductId.set(product.id, mode);
  }
  if (modeByProductId.size === 0) return { ...EMPTY_BUFFET_TABLE_SESSION_SUMMARY };

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("order_items")
    .select("product_id,quantity,line_total")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("order_id", args.orderId)
    .in("product_id", [...modeByProductId.keys()]);
  if (error) throw new Error(`buffet_order_items_query_failed:${error.message}`);

  let perPersonQuantity = 0;
  let setQuantity = 0;
  let subtotal = 0;
  for (const item of (data ?? []) as BuffetOrderItemRow[]) {
    const quantity = positiveQuantity(item.quantity);
    const mode = modeByProductId.get(item.product_id);
    if (mode === "per_person") perPersonQuantity += quantity;
    if (mode === "set") setQuantity += quantity;
    subtotal += Math.max(0, Number(item.line_total ?? 0));
  }

  const totalQuantity = perPersonQuantity + setQuantity;
  return {
    enabled: totalQuantity > 0,
    per_person_quantity: perPersonQuantity,
    set_quantity: setQuantity,
    total_quantity: totalQuantity,
    subtotal: roundMoney(subtotal),
    updated_at: new Date().toISOString()
  };
}

async function loadActiveTableSession(args: {
  tenantId: string;
  branchId: string;
  tableId?: string | null;
  orderId?: string | null;
}) {
  const supabase = getSupabaseServiceClient();
  let query = supabase
    .from("table_bill_sessions")
    .select("id,table_id,order_id,metadata")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .in("status", ["open", "ordering", "pending_payment"])
    .order("opened_at", { ascending: false })
    .limit(1);
  if (args.tableId) query = query.eq("table_id", args.tableId);
  if (args.orderId) query = query.eq("order_id", args.orderId);
  const { data, error } = await query.maybeSingle<ActiveTableSessionRow>();
  if (error) throw new Error(`buffet_table_session_query_failed:${error.message}`);
  return data ?? null;
}

export async function syncBuffetTableSessionSummary(args: {
  tenantId: string;
  branchId: string;
  tableId?: string | null;
  orderId: string;
}) {
  const session = await loadActiveTableSession({
    tenantId: args.tenantId,
    branchId: args.branchId,
    tableId: args.tableId,
    orderId: args.orderId
  });
  if (!session) throw new Error("buffet_table_session_not_open");

  const summary = await deriveBuffetTableSessionSummary({
    tenantId: args.tenantId,
    branchId: args.branchId,
    orderId: args.orderId
  });
  const nextMetadata = mergeBuffetTableSessionSummaryMetadata(session.metadata, summary);
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("table_bill_sessions")
    .update({ metadata: nextMetadata })
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("id", session.id)
    .eq("order_id", args.orderId);
  if (error) throw new Error(`buffet_table_session_update_failed:${error.message}`);

  return { table_id: session.table_id, order_id: args.orderId, summary };
}

export async function loadBuffetTableSessionByCode(args: {
  tenantId: string;
  branchId: string;
  tableCode: string;
}) {
  const supabase = getSupabaseServiceClient();
  const { data: table, error: tableError } = await supabase
    .from("dining_tables")
    .select("id,table_code,table_name")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("table_code", args.tableCode)
    .maybeSingle<{ id: string; table_code: string; table_name: string | null }>();
  if (tableError) throw new Error(`buffet_table_query_failed:${tableError.message}`);
  if (!table) throw new Error("buffet_table_not_found");

  const session = await loadActiveTableSession({ tenantId: args.tenantId, branchId: args.branchId, tableId: table.id });
  if (!session) {
    return {
      table_id: table.id,
      table_code: table.table_code,
      table_name: table.table_name,
      order_id: null,
      active: false,
      summary: { ...EMPTY_BUFFET_TABLE_SESSION_SUMMARY }
    };
  }

  let summary = normalizeBuffetTableSessionSummary(session.metadata);
  if (!summary.enabled && session.order_id) {
    try {
      const synced = await syncBuffetTableSessionSummary({
        tenantId: args.tenantId,
        branchId: args.branchId,
        tableId: table.id,
        orderId: session.order_id
      });
      summary = synced.summary;
    } catch {
      summary = normalizeBuffetTableSessionSummary(session.metadata);
    }
  }

  return {
    table_id: table.id,
    table_code: table.table_code,
    table_name: table.table_name,
    order_id: session.order_id,
    active: true,
    summary
  };
}
