import "server-only";

import {
  buffetPlanFromProduct,
  buffetPlanModeFromProduct,
  type BuffetPlanProductRow
} from "@/lib/pos-buffet-plan-product";
import type { PosBuffetPricingMode } from "@/lib/pos-buffet-pricing";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export const BUFFET_TABLE_ACCESS_METADATA_KEY = "cpipos_buffet_access";

export type BuffetTableAccess = {
  mode: PosBuffetPricingMode;
  plan_product_id: string;
  plan_code: string;
  plan_name: string;
  selected_at: string;
  updated_at: string;
};

type TableSessionRow = {
  id: string;
  order_id: string | null;
  metadata: Record<string, unknown> | null;
};

type OrderItemRow = {
  product_id: string | null;
  quantity: number | null;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function readBuffetTableAccessMetadata(metadata: Record<string, unknown> | null | undefined): BuffetTableAccess | null {
  const raw = recordValue(metadata?.[BUFFET_TABLE_ACCESS_METADATA_KEY]);
  if (!raw) return null;
  const mode = raw.mode === "set" ? "set" : raw.mode === "per_person" ? "per_person" : null;
  const planProductId = String(raw.plan_product_id ?? "").trim();
  if (!mode || !planProductId) return null;
  const selectedAt = String(raw.selected_at ?? raw.updated_at ?? "").trim() || new Date(0).toISOString();
  const updatedAt = String(raw.updated_at ?? raw.selected_at ?? "").trim() || selectedAt;
  return {
    mode,
    plan_product_id: planProductId,
    plan_code: String(raw.plan_code ?? planProductId).trim() || planProductId,
    plan_name: String(raw.plan_name ?? "Buffet").trim() || "Buffet",
    selected_at: selectedAt,
    updated_at: updatedAt
  };
}

export function mergeBuffetTableAccessMetadata(
  metadata: Record<string, unknown> | null | undefined,
  access: BuffetTableAccess
): Record<string, unknown> {
  const current = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  return {
    ...current,
    [BUFFET_TABLE_ACCESS_METADATA_KEY]: access
  };
}

async function loadSession(args: { tenantId: string; branchId: string; tableSessionId: string }) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("table_bill_sessions")
    .select("id,order_id,metadata")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("id", args.tableSessionId)
    .maybeSingle<TableSessionRow>();
  if (error) throw new Error(`buffet_access_session_query_failed:${error.message}`);
  if (!data) throw new Error("buffet_access_session_not_found");
  return data;
}

async function inferAccessFromCommittedOrder(args: {
  tenantId: string;
  branchId: string;
  orderId: string;
}): Promise<BuffetTableAccess | null> {
  const supabase = getSupabaseServiceClient();
  const { data: itemRows, error: itemError } = await supabase
    .from("order_items")
    .select("product_id,quantity")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("order_id", args.orderId)
    .gt("quantity", 0)
    .returns<OrderItemRow[]>();
  if (itemError) throw new Error(`buffet_access_order_items_query_failed:${itemError.message}`);

  const productIds = Array.from(new Set((itemRows ?? []).map((row) => String(row.product_id ?? "").trim()).filter(Boolean)));
  if (productIds.length === 0) return null;

  const { data: products, error: productError } = await supabase
    .from("products")
    .select("id,sku,name,price,is_active,metadata,created_at")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .in("id", productIds)
    .returns<BuffetPlanProductRow[]>();
  if (productError) throw new Error(`buffet_access_products_query_failed:${productError.message}`);

  const plans = (products ?? [])
    .filter((product) => buffetPlanModeFromProduct(product) !== null)
    .map((product) => buffetPlanFromProduct(product, 0))
    .filter((plan): plan is NonNullable<typeof plan> => Boolean(plan));

  if (plans.length === 0) return null;
  if (plans.length > 1) throw new Error("buffet_access_ambiguous");
  const plan = plans[0];
  const now = new Date().toISOString();
  return {
    mode: plan.mode,
    plan_product_id: String(plan.product_id ?? plan.id),
    plan_code: plan.code,
    plan_name: plan.name,
    selected_at: now,
    updated_at: now
  };
}

export async function loadBuffetTableAccess(args: {
  tenantId: string;
  branchId: string;
  tableSessionId: string;
}): Promise<{ session: TableSessionRow; access: BuffetTableAccess | null; source: "metadata" | "order" | "none" }> {
  const session = await loadSession(args);
  const stored = readBuffetTableAccessMetadata(session.metadata);
  if (stored) return { session, access: stored, source: "metadata" };
  if (!session.order_id) return { session, access: null, source: "none" };
  const inferred = await inferAccessFromCommittedOrder({
    tenantId: args.tenantId,
    branchId: args.branchId,
    orderId: session.order_id
  });
  return { session, access: inferred, source: inferred ? "order" : "none" };
}

export async function isBuffetPlanCommitted(args: {
  tenantId: string;
  branchId: string;
  orderId: string | null;
  planProductId: string;
}) {
  if (!args.orderId) return false;
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("order_items")
    .select("product_id,quantity")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("order_id", args.orderId)
    .eq("product_id", args.planProductId)
    .gt("quantity", 0)
    .limit(1);
  if (error) throw new Error(`buffet_access_commit_query_failed:${error.message}`);
  return Boolean(data && data.length > 0);
}

export async function saveBuffetTableAccess(args: {
  tenantId: string;
  branchId: string;
  tableSessionId: string;
  currentMetadata: Record<string, unknown> | null;
  access: BuffetTableAccess;
}) {
  const supabase = getSupabaseServiceClient();
  const metadata = mergeBuffetTableAccessMetadata(args.currentMetadata, args.access);
  const { error } = await supabase
    .from("table_bill_sessions")
    .update({ metadata })
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("id", args.tableSessionId);
  if (error) throw new Error(`buffet_access_update_failed:${error.message}`);
  return args.access;
}
