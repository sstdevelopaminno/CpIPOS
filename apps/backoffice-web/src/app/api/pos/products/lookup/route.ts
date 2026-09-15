import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
import { normalizeGeneralSaleScanCode } from "@/lib/pos-general-sale-mode";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type ProductRow = {
  id: string;
  sku: string | null;
  name: string | null;
  category: string | null;
  price: number | null;
  is_active: boolean | null;
  stock_deduction_mode: "unit_only" | "recipe_deduction" | null;
};

type RecipeStockRow = {
  quantity_per_item: number | null;
  ingredients:
    | { name: string | null; quantity_on_hand: number | null }
    | Array<{ name: string | null; quantity_on_hand: number | null }>
    | null;
};

function failFromLookupError(error: unknown) {
  if (error instanceof FeatureGateError) {
    return fail(error.code, error.message, error.status);
  }
  if (error instanceof PosGuardError) {
    return fail(error.code, error.message, error.status);
  }
  return fail("product_lookup_failed", error instanceof Error ? error.message : "Product lookup failed.", 500);
}

function selectProductQuery(input: {
  tenantId: string;
  branchId: string;
  supabase: ReturnType<typeof getSupabaseServiceClient>;
}) {
  return input.supabase
    .from("products")
    .select("id,sku,name,category,price,is_active,stock_deduction_mode")
    .eq("tenant_id", input.tenantId)
    .eq("branch_id", input.branchId)
    .eq("is_active", true);
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "sales:enter");
    await requireTenantFeature(scope.session.tenant_id, "core_pos_sales", scope.session.branch_id);
    await requireTenantFeature(scope.session.tenant_id, "barcode_scanner_mode", scope.session.branch_id);

    const { searchParams } = new URL(request.url);
    const rawCode = searchParams.get("sku") ?? "";
    const scanCode = normalizeGeneralSaleScanCode(rawCode);
    if (!scanCode || scanCode.length > 40) {
      return fail("invalid_scan_code", "SKU is required and must not exceed 40 characters.", 422);
    }

    const supabase = getSupabaseServiceClient();
    const tenantId = scope.session.tenant_id;
    const branchId = scope.session.branch_id;

    const exactResult = await selectProductQuery({ tenantId, branchId, supabase }).eq("sku", scanCode).limit(2);
    if (exactResult.error) {
      return fail("product_lookup_query_failed", exactResult.error.message, 500);
    }

    let candidates = (exactResult.data ?? []) as ProductRow[];

    // Legacy products may still carry a display-style SKU such as PRD-...-097339.
    // Product Management now persists the digit-normalized form, so for numeric scans
    // query a bounded legacy candidate set and then require exact normalized equality.
    if (candidates.length === 0 && /^\d+$/.test(scanCode)) {
      const legacyResult = await selectProductQuery({ tenantId, branchId, supabase })
        .ilike("sku", `%${scanCode}%`)
        .limit(25);
      if (legacyResult.error) {
        return fail("product_lookup_query_failed", legacyResult.error.message, 500);
      }
      candidates = ((legacyResult.data ?? []) as ProductRow[]).filter(
        (row) => normalizeGeneralSaleScanCode(row.sku) === scanCode
      );
    }

    if (candidates.length === 0) {
      const response = fail("product_not_found", `No active product matches SKU ${scanCode}.`, 404);
      response.headers.set("x-pos-product-lookup-ms", String(Date.now() - startedAt));
      return response;
    }
    if (candidates.length > 1) {
      const response = fail("ambiguous_product_sku", `More than one active product matches SKU ${scanCode}.`, 409);
      response.headers.set("x-pos-product-lookup-ms", String(Date.now() - startedAt));
      return response;
    }

    const product = candidates[0];
    const [{ data: recipeRows, error: recipeError }, { data: inventorySettings, error: inventoryError }] = await Promise.all([
      supabase
        .from("recipes")
        .select("quantity_per_item,ingredients(name,quantity_on_hand)")
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .eq("product_id", product.id),
      supabase
        .from("branch_inventory_settings")
        .select("allow_negative_stock")
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .maybeSingle<{ allow_negative_stock: boolean }>()
    ]);

    if (recipeError) {
      return fail("product_stock_lookup_failed", recipeError.message, 500);
    }

    const caps: number[] = [];
    let hasRecipeDeduction = false;
    for (const row of (recipeRows ?? []) as RecipeStockRow[]) {
      const required = Number(row.quantity_per_item ?? 0);
      if (!Number.isFinite(required) || required <= 0) continue;
      const ingredient = Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients;
      const ingredientName = String(ingredient?.name ?? "").trim();
      if (ingredientName && !ingredientName.startsWith("STOCK:")) {
        hasRecipeDeduction = true;
      }
      const onHand = Number(ingredient?.quantity_on_hand ?? 0);
      caps.push(Math.floor(onHand / required));
    }

    const stockOnHandUnits = caps.length > 0 ? Math.min(...caps) : null;
    const allowNegativeStock = inventoryError ? false : Boolean(inventorySettings?.allow_negative_stock ?? false);
    const isOutOfStock = !allowNegativeStock && stockOnHandUnits !== null && stockOnHandUnits <= 0;

    const response = ok({
      product: {
        id: String(product.id),
        sku: String(product.sku ?? ""),
        name: String(product.name ?? ""),
        category: String(product.category ?? ""),
        price: Number(product.price ?? 0),
        is_active: product.is_active !== false,
        stock_deduction_mode: product.stock_deduction_mode === "recipe_deduction" ? "recipe_deduction" : "unit_only",
        has_recipe_deduction: product.stock_deduction_mode === "recipe_deduction" && hasRecipeDeduction,
        stock_on_hand_units: stockOnHandUnits,
        is_out_of_stock: isOutOfStock
      }
    });
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("x-pos-product-lookup-ms", String(Date.now() - startedAt));
    return response;
  } catch (error) {
    const response = failFromLookupError(error);
    response.headers.set("x-pos-product-lookup-ms", String(Date.now() - startedAt));
    return response;
  }
}
