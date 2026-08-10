import "server-only";

import { getRoutedSupabaseServiceClient } from "@/lib/tenant-data-router";

type RecipeStockRow = {
  product_id: string;
  quantity_per_item: number | null;
  ingredients: { quantity_on_hand: number | null } | Array<{ quantity_on_hand: number | null }> | null;
};

export type TableQrStockState = {
  stock_on_hand_units: number | null;
  allow_negative_stock: boolean;
  is_available: boolean;
  is_low_stock: boolean;
};

export async function loadTableQrStockStates(args: {
  tenantId: string;
  branchId: string;
  productIds: string[];
}) {
  const ids = [...new Set(args.productIds.map((id) => String(id).trim()).filter(Boolean))];
  const states = new Map<string, TableQrStockState>();
  if (ids.length === 0) return states;

  const supabase = getRoutedSupabaseServiceClient();
  const [{ data: recipeRows, error: recipeError }, { data: settings, error: settingsError }] = await Promise.all([
    supabase
      .from("recipes")
      .select("product_id,quantity_per_item,ingredients(quantity_on_hand)")
      .eq("tenant_id", args.tenantId)
      .eq("branch_id", args.branchId)
      .in("product_id", ids),
    supabase
      .from("branch_inventory_settings")
      .select("allow_negative_stock")
      .eq("tenant_id", args.tenantId)
      .eq("branch_id", args.branchId)
      .maybeSingle()
  ]);

  if (recipeError) throw new Error(recipeError.message);
  if (settingsError) throw new Error(settingsError.message);

  const allowNegativeStock = settings?.allow_negative_stock === true;
  const capsByProduct = new Map<string, number[]>();
  for (const row of (recipeRows ?? []) as RecipeStockRow[]) {
    const productId = String(row.product_id ?? "").trim();
    const requiredQty = Number(row.quantity_per_item ?? 0);
    if (!productId || !Number.isFinite(requiredQty) || requiredQty <= 0) continue;
    const ingredient = Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients;
    const onHand = Number(ingredient?.quantity_on_hand ?? 0);
    const caps = capsByProduct.get(productId) ?? [];
    caps.push(Math.floor(onHand / requiredQty));
    capsByProduct.set(productId, caps);
  }

  for (const productId of ids) {
    const caps = capsByProduct.get(productId) ?? [];
    const stock = caps.length > 0 ? Math.min(...caps) : null;
    const isLow = !allowNegativeStock && stock !== null && stock <= 0;
    states.set(productId, {
      stock_on_hand_units: stock,
      allow_negative_stock: allowNegativeStock,
      is_available: allowNegativeStock || stock === null || stock > 0,
      is_low_stock: isLow
    });
  }
  return states;
}

export async function assertTableQrStockAvailable(args: {
  tenantId: string;
  branchId: string;
  items: Array<{ product_id: string; quantity: number }>;
}) {
  const states = await loadTableQrStockStates({
    tenantId: args.tenantId,
    branchId: args.branchId,
    productIds: args.items.map((item) => item.product_id)
  });

  for (const item of args.items) {
    const state = states.get(item.product_id);
    if (!state || state.allow_negative_stock || state.stock_on_hand_units === null) continue;
    if (!state.is_available || item.quantity > state.stock_on_hand_units) throw new Error("INSUFFICIENT_STOCK");
  }
}
