import "server-only";

import { buffetPlanModeFromProduct } from "@/lib/pos-buffet-plan-product";
import { isBuffetIncludedMenuProduct } from "@/lib/pos-buffet-menu-product";
import {
  isBuffetPlanCommitted,
  loadBuffetTableAccess,
  type BuffetTableAccess
} from "@/lib/services/buffet-table-access-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type TableQrContextLike = {
  tenant_id: string;
  branch_id: string;
  table_session_id: string;
};

type MenuProductLike = {
  id: string;
  name: string;
  category: string;
  price: number;
  [key: string]: unknown;
};

type ProductPolicyRow = {
  id: string;
  sku: string | null;
  name: string;
  category: string | null;
  price: number | null;
  is_active: boolean | null;
  metadata: Record<string, unknown> | null;
};

type ComboItemRow = {
  child_product_id: string;
};

export type TableQrBuffetInfo = {
  enabled: true;
  mode: "per_person" | "set";
  plan_product_id: string;
  plan_code: string;
  plan_name: string;
  package_quantity_locked: true;
};

async function resolveAccess(context: TableQrContextLike) {
  const state = await loadBuffetTableAccess({
    tenantId: context.tenant_id,
    branchId: context.branch_id,
    tableSessionId: context.table_session_id
  });
  if (!state.access) return { ...state, committed: false };
  const committed = await isBuffetPlanCommitted({
    tenantId: context.tenant_id,
    branchId: context.branch_id,
    orderId: state.session.order_id,
    planProductId: state.access.plan_product_id
  });
  return { ...state, committed };
}

function buffetInfo(access: BuffetTableAccess): TableQrBuffetInfo {
  return {
    enabled: true,
    mode: access.mode,
    plan_product_id: access.plan_product_id,
    plan_code: access.plan_code,
    plan_name: access.plan_name,
    package_quantity_locked: true
  };
}

async function loadProductRows(context: TableQrContextLike, productIds: string[]) {
  const ids = Array.from(new Set(productIds.map((id) => String(id ?? "").trim()).filter(Boolean)));
  if (ids.length === 0) return [] as ProductPolicyRow[];
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select("id,sku,name,category,price,is_active,metadata")
    .eq("tenant_id", context.tenant_id)
    .eq("branch_id", context.branch_id)
    .in("id", ids)
    .returns<ProductPolicyRow[]>();
  if (error) throw new Error(`buffet_qr_products_query_failed:${error.message}`);
  return data ?? [];
}

async function loadValidatedSetMembership(context: TableQrContextLike, access: BuffetTableAccess) {
  const supabase = getSupabaseServiceClient();
  const { data: links, error: linkError } = await supabase
    .from("product_combo_items")
    .select("child_product_id")
    .eq("tenant_id", context.tenant_id)
    .eq("branch_id", context.branch_id)
    .eq("combo_product_id", access.plan_product_id)
    .returns<ComboItemRow[]>();
  if (linkError) throw new Error(`buffet_set_items_query_failed:${linkError.message}`);
  const ids = Array.from(new Set((links ?? []).map((row) => String(row.child_product_id ?? "").trim()).filter(Boolean)));
  if (ids.length === 0) return new Set<string>();

  const rows = await loadProductRows(context, ids);
  if (rows.length !== ids.length) throw new Error("BUFFET_SET_INVALID_ITEM");
  for (const row of rows) {
    if (buffetPlanModeFromProduct(row) || !isBuffetIncludedMenuProduct(row)) {
      throw new Error("BUFFET_SET_INVALID_ITEM");
    }
  }
  return new Set(ids);
}

export async function assertTableQrBuffetReadyForIssue(context: TableQrContextLike) {
  const state = await resolveAccess(context);
  if (!state.access) return null;
  if (!state.committed) throw new Error("BUFFET_PLAN_NOT_COMMITTED");
  if (state.access.mode === "set") await loadValidatedSetMembership(context, state.access);
  return state.access;
}

export async function filterTableQrMenuForBuffet<T extends MenuProductLike>(args: {
  context: TableQrContextLike;
  products: T[];
}): Promise<{ products: Array<T & { buffet_included: boolean }>; buffet: TableQrBuffetInfo | null }> {
  const state = await resolveAccess(args.context);
  const rows = await loadProductRows(args.context, args.products.map((product) => product.id));
  const rowById = new Map(rows.map((row) => [row.id, row]));

  if (!state.access) {
    return {
      buffet: null,
      products: args.products
        .filter((product) => {
          const row = rowById.get(product.id);
          if (!row) return false;
          if (buffetPlanModeFromProduct(row)) return false;
          return !isBuffetIncludedMenuProduct(row);
        })
        .map((product) => ({ ...product, buffet_included: false }))
    };
  }

  if (!state.committed) throw new Error("BUFFET_PLAN_NOT_COMMITTED");
  const access = state.access;

  if (access.mode === "set") {
    const membership = await loadValidatedSetMembership(args.context, access);
    return {
      buffet: buffetInfo(access),
      products: args.products
        .filter((product) => membership.has(product.id))
        .map((product) => ({ ...product, buffet_included: true }))
    };
  }

  return {
    buffet: buffetInfo(access),
    products: args.products
      .filter((product) => {
        const row = rowById.get(product.id);
        return Boolean(row && !buffetPlanModeFromProduct(row));
      })
      .map((product) => {
        const row = rowById.get(product.id)!;
        return { ...product, buffet_included: isBuffetIncludedMenuProduct(row) };
      })
  };
}

export async function assertTableQrBuffetItemsAllowed(args: {
  context: TableQrContextLike;
  items: Array<{ product_id: string; quantity: number }>;
}) {
  const requestedIds = Array.from(new Set(args.items.map((item) => String(item.product_id ?? "").trim()).filter(Boolean)));
  const rows = await loadProductRows(args.context, requestedIds);
  if (rows.length !== requestedIds.length || rows.some((row) => row.is_active === false)) {
    throw new Error("PRODUCT_NOT_AVAILABLE");
  }
  const rowById = new Map(rows.map((row) => [row.id, row]));
  if (rows.some((row) => buffetPlanModeFromProduct(row))) {
    throw new Error("BUFFET_PRICE_PLAN_QR_FORBIDDEN");
  }

  const state = await resolveAccess(args.context);
  if (!state.access) {
    if (rows.some((row) => isBuffetIncludedMenuProduct(row))) throw new Error("BUFFET_ACCESS_REQUIRED");
    return;
  }
  if (!state.committed) throw new Error("BUFFET_PLAN_NOT_COMMITTED");

  if (state.access.mode === "per_person") return;

  const membership = await loadValidatedSetMembership(args.context, state.access);
  for (const productId of requestedIds) {
    const row = rowById.get(productId);
    if (!row || !membership.has(productId) || !isBuffetIncludedMenuProduct(row)) {
      throw new Error("BUFFET_SET_ITEM_NOT_INCLUDED");
    }
  }
}
