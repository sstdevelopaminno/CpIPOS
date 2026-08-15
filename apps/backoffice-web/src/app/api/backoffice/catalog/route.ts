import { getAuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import { convertToGrams, toIntegerGrams } from "@/lib/ingredient-stock";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { buildPaginationMeta, parsePagination, sanitizeSearchTerm } from "@/lib/query-params";
import { mergeCategoryCountItems } from "@/lib/pos/category-normalization";
import { withProductRecommendedMetadata } from "@/lib/pos/product-metadata";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type UpsertProductPayload = {
  action: "upsert_product";
  id?: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  sell_unit?: string;
  stock_deduction_mode?: "unit_only" | "recipe_deduction";
  is_active?: boolean;
  is_recommended?: boolean;
};

type UpsertIngredientPayload = {
  action: "upsert_ingredient";
  id?: string;
  name: string;
  base_unit: string;
  reorder_level?: number;
  quantity_on_hand?: number;
  avg_unit_cost?: number;
};

type AddIngredientStockPayload = {
  action: "add_ingredient_stock";
  ingredient_id?: string;
  ingredient_name?: string;
  base_unit?: string;
  quantity_delta?: number;
  purchase_quantity?: number;
  purchase_unit?: "kg" | "kilogram" | "gram" | "g" | "khid" | "bag" | "piece" | "unit" | "ลูก";
  weight_per_bag_in_grams?: number;
  reason?: string;
  received_total_cost?: number;
};

type DeleteIngredientPayload = {
  action: "delete_ingredient";
  ingredient_id: string;
};

type UpsertRecipeLinePayload = {
  action: "upsert_recipe_line";
  product_id: string;
  ingredient_id: string;
  quantity_per_item: number;
  quantity_unit?: "gram" | "khid" | "kg" | "piece";
  applies_when_takeaway_only?: boolean;
};

type DeleteRecipeLinePayload = {
  action: "delete_recipe_line";
  product_id: string;
  ingredient_id: string;
  applies_when_takeaway_only?: boolean;
};

type CreateProductWithStockSetupPayload = {
  action: "create_product_with_stock_setup";
  sku?: string;
  name: string;
  category: string;
  stock_quantity: number;
  store_price: number;
  delivery_price: number;
  delivery_prices_by_channel?: {
    line_man?: number;
    grab?: number;
    shopee?: number;
  };
  use_ingredient_recipe: boolean;
  is_recommended?: boolean;
  ingredient_lines?: Array<{
    ingredient_id: string;
    quantity: number;
    quantity_unit: "gram" | "khid" | "kg" | "piece";
  }>;
};

type UpdateProductWithStockSetupPayload = {
  action: "update_product_with_stock_setup";
  product_id: string;
  name: string;
  category: string;
  stock_quantity: number;
  store_price: number;
  delivery_price: number;
  delivery_prices_by_channel?: {
    line_man?: number;
    grab?: number;
    shopee?: number;
  };
  use_ingredient_recipe: boolean;
  is_recommended?: boolean;
  customer_ingredient_selection_enabled?: boolean;
  ingredient_lines?: Array<{
    ingredient_id: string;
    quantity: number;
    quantity_unit: "gram" | "khid" | "kg" | "piece";
  }>;
};

type DeactivateProductPayload = {
  action: "deactivate_product";
  product_id: string;
};

type BulkDeactivateProductsPayload = {
  action: "bulk_deactivate_products";
  product_ids: string[];
};

type BulkUnlinkProductRecipesPayload = {
  action: "bulk_unlink_product_recipes";
  product_ids: string[];
  stock_quantity?: number;
};

type BulkDeleteIngredientsPayload = {
  action: "bulk_delete_ingredients";
  ingredient_ids: string[];
};

type CreateCategoryPayload = {
  action: "create_category";
  name: string;
};

type RenameCategoryPayload = {
  action: "rename_category";
  old_name: string;
  name: string;
};

type DeleteCategoryPayload = {
  action: "delete_category";
  name: string;
};

type CatalogBranchScopedPayload = {
  branch_id?: string;
};

type CatalogActionPayload =
  | UpsertProductPayload
  | UpsertIngredientPayload
  | AddIngredientStockPayload
  | DeleteIngredientPayload
  | UpsertRecipeLinePayload
  | DeleteRecipeLinePayload
  | CreateProductWithStockSetupPayload
  | UpdateProductWithStockSetupPayload
  | DeactivateProductPayload
  | BulkDeactivateProductsPayload
  | BulkUnlinkProductRecipesPayload
  | BulkDeleteIngredientsPayload
  | CreateCategoryPayload
  | RenameCategoryPayload
  | DeleteCategoryPayload;

type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

const PRODUCT_SELECT = "id,sku,name,category,price,stock_deduction_mode,is_active,updated_at,metadata";
const DELIVERY_CHANNELS = ["line_man", "grab", "shopee"] as const;
type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];
const ARCHIVED_INGREDIENT_PREFIX = "__archived__:";
const FALLBACK_INGREDIENT_PREFIX = "STOCK:";

function canManageCatalogRole(role: string | null): boolean {
  return role === "owner" || role === "manager";
}

async function resolveScopedBranchId(input: {
  supabase: ReturnType<typeof getSupabaseServiceClient>;
  tenantId: string;
  userId: string;
  currentBranchId: string;
  branchRole: string | null;
  requestedBranchId: string | null;
}) {
  const normalizedRequested = String(input.requestedBranchId ?? "").trim();
  if (!normalizedRequested || normalizedRequested === input.currentBranchId) {
    return input.currentBranchId;
  }

  if (!canManageCatalogRole(input.branchRole)) {
    throw new Error("forbidden_branch_scope");
  }

  const { data, error } = await input.supabase
    .from("user_branch_roles")
    .select("branch_id")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId)
    .eq("branch_id", normalizedRequested)
    .limit(1);

  if (error) {
    throw new Error(`branch_scope_query_failed:${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new Error("forbidden_branch_scope");
  }

  return normalizedRequested;
}

function buildDeliveryPriceByChannel(input: {
  deliveryPrice: number;
  deliveryPricesByChannel?: CreateProductWithStockSetupPayload["delivery_prices_by_channel"] | UpdateProductWithStockSetupPayload["delivery_prices_by_channel"];
}): Record<DeliveryChannel, number> {
  const fallbackPrice = Number(input.deliveryPrice.toFixed(2));
  const source = input.deliveryPricesByChannel ?? {};

  return {
    line_man: Number((Number(source.line_man ?? fallbackPrice)).toFixed(2)),
    grab: Number((Number(source.grab ?? fallbackPrice)).toFixed(2)),
    shopee: Number((Number(source.shopee ?? fallbackPrice)).toFixed(2))
  };
}

function round3(value: number) {
  return Number(value.toFixed(3));
}

function round4(value: number) {
  return Number(value.toFixed(4));
}

function isMissingIngredientCostColumnsError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  if (code === "42703") return true;
  return text.includes("avg_unit_cost") || text.includes("last_purchase_unit_cost");
}

function isMissingSellUnitColumnError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  if (code === "42703") return true;
  return text.includes("sell_unit") && text.includes("column");
}

function isMissingStockDeductionModeColumnError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return text.includes("stock_deduction_mode") && text.includes("column");
}

function isMissingTableError(error: PostgrestLikeError | null | undefined, tableName: string): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return code === "PGRST205" || (text.includes("could not find the table") && text.includes(tableName.toLowerCase()));
}

function isForeignKeyReferenceError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return code === "23503" || text.includes("foreign key") || text.includes("violates");
}

function isMissingProductTrashColumnsError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return text.includes("deleted_at") || text.includes("deleted_by") || text.includes("delete_reason") || text.includes("restore_until");
}

function normalizeSku(raw: string | undefined) {
  const digits = String(raw ?? "").replace(/\D+/g, "");
  if (digits) return digits.slice(0, 40);

  const timestamp = Date.now().toString();
  const randomSuffix = Math.floor(Math.random() * 1000000)
    .toString()
    .padStart(6, "0");
  return `${timestamp}${randomSuffix}`.slice(0, 40);
}

async function softDeleteProducts(input: {
  supabase: ReturnType<typeof getSupabaseServiceClient>;
  tenantId: string;
  branchId: string;
  productIds: string[];
  userId: string;
  reason: string;
}) {
  const now = new Date();
  const restoreUntil = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const trashPatch = {
    is_active: false,
    deleted_at: now.toISOString(),
    deleted_by: input.userId,
    delete_reason: input.reason,
    restore_until: restoreUntil
  };

  const run = (patch: Record<string, unknown>) =>
    input.supabase
      .from("products")
      .update(patch)
      .eq("tenant_id", input.tenantId)
      .eq("branch_id", input.branchId)
      .in("id", input.productIds)
      .select("id");

  let result = await run(trashPatch);
  if (result.error && isMissingProductTrashColumnsError(result.error)) {
    result = await run({ is_active: false });
  }
  return result;
}

async function ensureProductCategory(input: {
  supabase: ReturnType<typeof getSupabaseServiceClient>;
  tenantId: string;
  branchId: string;
  name: string;
  userId: string;
}) {
  const categoryName = input.name.trim();
  if (!categoryName) return { ok: true as const };

  const { error } = await input.supabase.from("product_categories").upsert(
    {
      tenant_id: input.tenantId,
      branch_id: input.branchId,
      name: categoryName,
      created_by: input.userId
    },
    { onConflict: "tenant_id,branch_id,name" }
  );
  if (error && (isMissingTableError(error, "product_categories") || isForeignKeyReferenceError(error))) {
    return { ok: true as const, persisted: false as const };
  }
  if (error && !isMissingTableError(error, "product_categories")) {
    return { ok: false as const, error };
  }
  return { ok: true as const, persisted: true as const };
}

function normalizeRecipeQuantityUnit(unit: unknown): "gram" | "khid" | "kg" | "piece" {
  if (unit === "khid") return "khid";
  if (unit === "kg") return "kg";
  if (unit === "piece" || unit === "unit" || unit === "ลูก") return "piece";
  return "gram";
}

function isPieceBaseUnit(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "piece" || normalized === "unit" || normalized === "ลูก";
}

function toRecipeQuantityByIngredientBaseUnit(input: {
  quantity: number;
  quantityUnit: "gram" | "khid" | "kg" | "piece";
  ingredientBaseUnit: string;
}): number {
  const ingredientBaseUnit = String(input.ingredientBaseUnit ?? "").trim().toLowerCase();
  const isPieceBaseUnit = ingredientBaseUnit === "piece" || ingredientBaseUnit === "unit" || ingredientBaseUnit === "ลูก";

  if (isPieceBaseUnit) {
    if (input.quantityUnit !== "piece") {
      throw new Error(`invalid_recipe_unit_for_piece_ingredient:${input.quantityUnit}`);
    }
    return toIntegerGrams(input.quantity);
  }

  if (input.quantityUnit === "piece") {
    throw new Error("piece_unit_requires_piece_base_unit");
  }

  return toIntegerGrams(convertToGrams(input.quantity, input.quantityUnit));
}

export async function GET(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    await requirePosApiFeature(auth, "stock_management");
    const supabase = getSupabaseServiceClient();
    const { searchParams } = new URL(req.url);
    const view = searchParams.get("view")?.trim() || "products";
    const requestedBranchId = searchParams.get("branch_id")?.trim() ?? null;
    const useAllBranchesForBestSellers = view === "best_sellers" && requestedBranchId === "all" && canManageCatalogRole(auth.branchRole);
    const scopedBranchId = await resolveScopedBranchId({
      supabase,
      tenantId: auth.tenantId!,
      userId: auth.userId,
      currentBranchId: auth.branchId!,
      branchRole: auth.branchRole,
      requestedBranchId: useAllBranchesForBestSellers ? null : requestedBranchId
    });
    const { page, pageSize } = parsePagination(searchParams, 12);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const search = sanitizeSearchTerm(searchParams.get("search"));

    if (view === "ingredients") {
      const applyIngredientFilters = (query: any) => {
        let nextQuery = query
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", scopedBranchId)
          .not("name", "ilike", `${ARCHIVED_INGREDIENT_PREFIX}%`)
          .not("name", "ilike", `${FALLBACK_INGREDIENT_PREFIX}%`)
          .order("updated_at", { ascending: false })
          .range(from, to);
        if (search) {
          nextQuery = nextQuery.or(`name.ilike.%${search}%`);
        }
        return nextQuery;
      };

      const baseSelect = "id,name,base_unit,quantity_on_hand,reorder_level,updated_at";
      const enrichedSelect = `${baseSelect},avg_unit_cost,last_purchase_unit_cost`;
      const { data, error, count } = await applyIngredientFilters(
        supabase.from("ingredients").select(enrichedSelect, { count: "exact" })
      );

      if (error && isMissingIngredientCostColumnsError(error)) {
        const legacy = await applyIngredientFilters(supabase.from("ingredients").select(baseSelect, { count: "exact" }));
        if (legacy.error) {
          return fail("ingredients_query_failed", legacy.error.message, 500);
        }
        const normalized = (legacy.data ?? []).map((row: any) => ({
          ...row,
          avg_unit_cost: 0,
          last_purchase_unit_cost: 0
        }));
        return ok({
          view: "ingredients",
          items: normalized,
          pagination: buildPaginationMeta(page, pageSize, legacy.count)
        });
      }

      if (error) {
        return fail("ingredients_query_failed", error.message, 500);
      }

      return ok({
        view: "ingredients",
        items: data ?? [],
        pagination: buildPaginationMeta(page, pageSize, count)
      });
    }

    if (view === "recipes") {
      const productId = searchParams.get("product_id")?.trim();
      if (!productId) {
        return fail("missing_product_id", "product_id is required for recipes view.", 422);
      }

      const { data, error, count } = await supabase
        .from("recipes")
        .select("id,product_id,ingredient_id,quantity_per_item,applies_when_takeaway_only,created_at,ingredients(name,base_unit)", {
          count: "exact"
        })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .eq("product_id", productId)
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) {
        return fail("recipes_query_failed", error.message, 500);
      }

      const { data: productSettings, error: productSettingsError } = await supabase
        .from("products")
        .select("customer_ingredient_selection_enabled")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .eq("id", productId)
        .maybeSingle<{ customer_ingredient_selection_enabled: boolean | null }>();
      if (productSettingsError) {
        return fail("recipe_product_settings_query_failed", productSettingsError.message, 500);
      }

      return ok({
        view: "recipes",
        items: data ?? [],
        customer_ingredient_selection_enabled: productSettings?.customer_ingredient_selection_enabled === true,
        pagination: buildPaginationMeta(page, pageSize, count)
      });
    }

    if (view === "cost_report") {
      let productQuery = supabase
        .from("products")
        .select("id,sku,name,category,price,stock_deduction_mode,is_active,updated_at", { count: "exact" })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .range(from, to);

      const mode = searchParams.get("mode")?.trim();
      const category = searchParams.get("category")?.trim();
      if (mode === "unit_only" || mode === "recipe_deduction") {
        productQuery = productQuery.eq("stock_deduction_mode", mode);
      }
      if (category) {
        productQuery = productQuery.eq("category", category);
      }
      if (search) {
        productQuery = productQuery.or(`name.ilike.%${search}%,sku.ilike.%${search}%,category.ilike.%${search}%`);
      }

      const { data: productRows, error: productError, count } = await productQuery;
      if (productError) {
        return fail("cost_report_products_query_failed", productError.message, 500);
      }

      const productIds = (productRows ?? []).map((row) => String(row.id));
      let recipeRows: Array<{
        product_id: string;
        quantity_per_item: number;
        ingredients?: { avg_unit_cost?: number } | null;
      }> = [];

      if (productIds.length > 0) {
        const { data: recipesData, error: recipesError } = await supabase
          .from("recipes")
          .select("product_id,quantity_per_item,ingredients(avg_unit_cost)")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", scopedBranchId)
          .in("product_id", productIds);
        if (recipesError && !isMissingIngredientCostColumnsError(recipesError)) {
          return fail("cost_report_recipes_query_failed", recipesError.message, 500);
        }
        if (!recipesError) {
          recipeRows = (recipesData ?? []) as typeof recipeRows;
        } else {
          const legacyRecipes = await supabase
            .from("recipes")
            .select("product_id,quantity_per_item")
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", scopedBranchId)
            .in("product_id", productIds);
          if (legacyRecipes.error) {
            return fail("cost_report_recipes_query_failed", legacyRecipes.error.message, 500);
          }
          recipeRows = (legacyRecipes.data ?? []).map((row) => ({
            product_id: String(row.product_id),
            quantity_per_item: Number(row.quantity_per_item ?? 0),
            ingredients: { avg_unit_cost: 0 }
          }));
        }
      }

      const rollup = new Map<string, { estimatedCost: number; ingredientLines: number; zeroCostLines: number }>();
      for (const row of recipeRows) {
        const productId = String(row.product_id);
        const prev = rollup.get(productId) ?? { estimatedCost: 0, ingredientLines: 0, zeroCostLines: 0 };
        const avgCost = Number(row.ingredients?.avg_unit_cost ?? 0);
        const lineCost = Number(row.quantity_per_item ?? 0) * Math.max(0, avgCost);
        prev.estimatedCost += lineCost;
        prev.ingredientLines += 1;
        if (avgCost <= 0) {
          prev.zeroCostLines += 1;
        }
        rollup.set(productId, prev);
      }

      const items = (productRows ?? []).map((row) => {
        const summary = rollup.get(String(row.id)) ?? { estimatedCost: 0, ingredientLines: 0, zeroCostLines: 0 };
        const salePrice = Number(row.price ?? 0);
        const estimatedCost = Number(summary.estimatedCost.toFixed(2));
        const estimatedGrossProfit = Number((salePrice - estimatedCost).toFixed(2));
        const estimatedMarginPct = salePrice > 0 ? Number(((estimatedGrossProfit / salePrice) * 100).toFixed(2)) : 0;

        return {
          product_id: row.id,
          sku: row.sku,
          name: row.name,
          category: row.category,
          stock_deduction_mode: row.stock_deduction_mode,
          sale_price: salePrice,
          estimated_cost_per_item: estimatedCost,
          estimated_gross_profit: estimatedGrossProfit,
          estimated_margin_pct: estimatedMarginPct,
          ingredient_lines: summary.ingredientLines,
          missing_cost_lines: summary.zeroCostLines,
          updated_at: row.updated_at
        };
      });

      return ok({
        view: "cost_report",
        items,
        pagination: buildPaginationMeta(page, pageSize, count)
      });
    }

    if (view === "best_sellers") {
      const daysRaw = Number(searchParams.get("days") ?? 30);
      const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(180, Math.trunc(daysRaw))) : 30;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      let branchIds = [scopedBranchId];
      let branchOptions: Array<{ id: string; name: string | null; code: string | null }> = [];
      if (useAllBranchesForBestSellers) {
        const [{ data: branchRows, error: branchError }, { data: membershipRows, error: membershipError }] = await Promise.all([
          supabase
            .from("branches")
            .select("id,name,code,is_active")
            .eq("tenant_id", auth.tenantId!)
            .eq("is_active", true)
            .order("name", { ascending: true }),
          supabase
            .from("user_branch_roles")
            .select("branch_id")
            .eq("tenant_id", auth.tenantId!)
            .eq("user_id", auth.userId)
        ]);
        if (branchError || membershipError) {
          return fail("best_seller_branch_query_failed", branchError?.message ?? membershipError?.message ?? "Unable to load branches.", 500);
        }
        const allowed = new Set((membershipRows ?? []).map((row) => String((row as { branch_id?: string | null }).branch_id ?? "")));
        branchOptions = ((branchRows ?? []) as Array<{ id: string; name: string | null; code: string | null; is_active: boolean }>)
          .filter((row) => row.is_active && allowed.has(String(row.id)))
          .map((row) => ({ id: String(row.id), name: row.name, code: row.code }));
        branchIds = branchOptions.map((branch) => branch.id);
      } else {
        const { data: branchRow } = await supabase
          .from("branches")
          .select("id,name,code")
          .eq("tenant_id", auth.tenantId!)
          .eq("id", scopedBranchId)
          .maybeSingle<{ id: string; name: string | null; code: string | null }>();
        branchOptions = branchRow ? [branchRow] : [{ id: scopedBranchId, name: scopedBranchId, code: null }];
      }

      if (branchIds.length === 0) {
        return ok({ view: "best_sellers", days, branch_id: "all", branch_options: [], items: [], summary: { units: 0, revenue: 0 } });
      }

      const orderQuery = supabase
        .from("orders")
        .select("id,branch_id,status,created_at")
        .eq("tenant_id", auth.tenantId!)
        .eq("status", "completed")
        .gte("created_at", since)
        .limit(1000);
      const { data: orderRows, error: orderError } =
        branchIds.length === 1 ? await orderQuery.eq("branch_id", branchIds[0]) : await orderQuery.in("branch_id", branchIds);
      if (orderError) {
        return fail("best_seller_orders_query_failed", orderError.message, 500);
      }

      const orders = (orderRows ?? []) as Array<{ id: string; branch_id: string; created_at: string }>;
      const orderIds = orders.map((order) => String(order.id));
      if (orderIds.length === 0) {
        return ok({
          view: "best_sellers",
          days,
          branch_id: useAllBranchesForBestSellers ? "all" : scopedBranchId,
          branch_options: branchOptions,
          items: [],
          summary: { units: 0, revenue: 0 }
        });
      }

      const { data: itemRows, error: itemError } = await supabase
        .from("order_items")
        .select("order_id,product_id,quantity,line_total,products(id,sku,name,category)")
        .eq("tenant_id", auth.tenantId!)
        .in("order_id", orderIds)
        .limit(5000);
      if (itemError) {
        return fail("best_seller_items_query_failed", itemError.message, 500);
      }

      const branchByOrder = new Map(orders.map((order) => [String(order.id), String(order.branch_id)]));
      const branchLabelById = new Map(branchOptions.map((branch) => [branch.id, branch.name ?? branch.code ?? branch.id]));
      const rollup = new Map<
        string,
        {
          product_id: string;
          sku: string | null;
          name: string;
          category: string | null;
          units: number;
          revenue: number;
          branchIds: Set<string>;
        }
      >();

      for (const row of itemRows ?? []) {
        const productRecord = Array.isArray(row.products) ? row.products[0] : row.products;
        const productId = String(row.product_id ?? productRecord?.id ?? "");
        if (!productId) continue;
        const current =
          rollup.get(productId) ??
          {
            product_id: productId,
            sku: productRecord?.sku ?? null,
            name: String(productRecord?.name ?? productId),
            category: productRecord?.category ?? null,
            units: 0,
            revenue: 0,
            branchIds: new Set<string>()
          };
        current.units += Number(row.quantity ?? 0);
        current.revenue += Number(row.line_total ?? 0);
        const branchId = branchByOrder.get(String(row.order_id));
        if (branchId) current.branchIds.add(branchId);
        rollup.set(productId, current);
      }

      const items = Array.from(rollup.values())
        .sort((a, b) => b.units - a.units || b.revenue - a.revenue || a.name.localeCompare(b.name))
        .slice(0, 30)
        .map((item, index) => ({
          rank: index + 1,
          tier: index === 0 ? "gold" : index === 1 ? "silver" : index === 2 ? "bronze" : "standard",
          product_id: item.product_id,
          sku: item.sku,
          name: item.name,
          category: item.category,
          units: Number(item.units.toFixed(3)),
          revenue: Number(item.revenue.toFixed(2)),
          branches: Array.from(item.branchIds)
            .map((branchId) => branchLabelById.get(branchId) ?? branchId)
            .sort((a, b) => a.localeCompare(b))
        }));

      return ok({
        view: "best_sellers",
        days,
        branch_id: useAllBranchesForBestSellers ? "all" : scopedBranchId,
        branch_options: branchOptions,
        items,
        summary: {
          units: Number(items.reduce((sum, item) => sum + item.units, 0).toFixed(3)),
          revenue: Number(items.reduce((sum, item) => sum + item.revenue, 0).toFixed(2))
        }
      });
    }

    if (view === "categories") {
      const [{ data, error }, registryResult] = await Promise.all([
        supabase
          .from("products")
          .select("category")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", scopedBranchId)
          .eq("is_active", true),
        supabase
          .from("product_categories")
          .select("name")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", scopedBranchId)
          .order("name", { ascending: true })
      ]);

      if (error) {
        return fail("categories_query_failed", error.message, 500);
      }
      if (registryResult.error && !isMissingTableError(registryResult.error, "product_categories")) {
        return fail("categories_registry_query_failed", registryResult.error.message, 500);
      }

      const items = mergeCategoryCountItems(
        [
          ...(data ?? []).map((row) => ({ name: String(row.category ?? ""), productCount: 1 })),
          ...(registryResult.error ? [] : registryResult.data ?? []).map((row) => ({
            name: String((row as { name?: string | null }).name ?? ""),
            productCount: 0
          }))
        ],
        "th"
      ).map((item) => ({ category: item.name, count: item.productCount }));

      return ok({
        view: "categories",
        items,
        pagination: buildPaginationMeta(1, Math.max(items.length, 1), items.length)
      });
    }

    let productsQuery = supabase
      .from("products")
      .select(PRODUCT_SELECT, { count: "exact" })
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", scopedBranchId)
      .order("updated_at", { ascending: false })
      .range(from, to);

    const mode = searchParams.get("mode")?.trim();
    const category = searchParams.get("category")?.trim();
    const onlyActive = searchParams.get("active")?.trim();

    if (mode === "unit_only" || mode === "recipe_deduction") {
      productsQuery = productsQuery.eq("stock_deduction_mode", mode);
    }
    if (category) {
      productsQuery = productsQuery.eq("category", category);
    }
    if (onlyActive === "true") {
      productsQuery = productsQuery.eq("is_active", true);
    }
    if (search) {
      productsQuery = productsQuery.or(`name.ilike.%${search}%,sku.ilike.%${search}%,category.ilike.%${search}%`);
    }

    const { data, error, count } = await productsQuery;
    if (error) {
      return fail("products_query_failed", error.message, 500);
    }

    return ok({
      view: "products",
      items: data ?? [],
      pagination: buildPaginationMeta(page, pageSize, count)
    });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    const message = error instanceof Error ? error.message : "Authentication failed.";
    if (message === "forbidden_branch_scope") {
      return fail("forbidden_branch_scope", "ไม่สามารถแก้ไขข้อมูลข้ามสาขาได้ กรุณารีเฟรชหน้าแล้วเลือกสาขาปัจจุบันอีกครั้ง", 403);
    }
    if (message.startsWith("branch_scope_query_failed:")) {
      return fail("branch_scope_query_failed", message.slice("branch_scope_query_failed:".length), 500);
    }
    return fail("unauthorized", message, 401);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    await requirePosApiFeature(auth, "stock_management");
    const supabase = getSupabaseServiceClient();
    if (!canManageCatalogRole(auth.branchRole)) {
      return fail("forbidden_role", "Only manager or owner can modify catalog.", 403);
    }

    const rawBody = (await req.json()) as CatalogActionPayload & CatalogBranchScopedPayload;
    const scopedBranchId = await resolveScopedBranchId({
      supabase,
      tenantId: auth.tenantId!,
      userId: auth.userId,
      currentBranchId: auth.branchId!,
      branchRole: auth.branchRole,
      requestedBranchId: typeof rawBody.branch_id === "string" ? rawBody.branch_id : null
    });
    const body = rawBody as CatalogActionPayload;
    const deleteOrArchiveIngredient = async (ingredientId: string) => {
      const { data: ingredient, error: ingredientError } = await supabase
        .from("ingredients")
        .select("id,name")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .eq("id", ingredientId)
        .maybeSingle<{ id: string; name: string }>();
      if (ingredientError) {
        return { ok: false as const, code: "ingredient_query_failed", message: ingredientError.message, status: 500 };
      }
      if (!ingredient) {
        return { ok: false as const, code: "ingredient_not_found", message: "Ingredient not found in this branch.", status: 404 };
      }

      const { error: deleteError } = await supabase
        .from("ingredients")
        .delete()
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .eq("id", ingredientId);
      if (!deleteError) {
        return { ok: true as const, archived: false };
      }

      if (!isForeignKeyReferenceError(deleteError)) {
        return {
          ok: false as const,
          code: "ingredient_delete_failed",
          message: "Cannot delete this ingredient yet. It may still be referenced by stock movements or related records.",
          status: 422
        };
      }

      const { error: deleteRecipeError } = await supabase
        .from("recipes")
        .delete()
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .eq("ingredient_id", ingredientId);
      if (deleteRecipeError) {
        return { ok: false as const, code: "ingredient_archive_failed", message: deleteRecipeError.message, status: 500 };
      }

      const { error: deletePackageError } = await supabase
        .from("ingredient_packages")
        .delete()
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .eq("ingredient_id", ingredientId);
      if (deletePackageError && !isMissingTableError(deletePackageError, "ingredient_packages")) {
        return { ok: false as const, code: "ingredient_archive_failed", message: deletePackageError.message, status: 500 };
      }

      const archiveName = `${ARCHIVED_INGREDIENT_PREFIX}${ingredient.name}:${ingredientId.slice(0, 8)}`;
      const { error: archiveError } = await supabase
        .from("ingredients")
        .update({
          name: archiveName,
          quantity_on_hand: 0,
          reorder_level: 0
        })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .eq("id", ingredientId);
      if (archiveError) {
        return { ok: false as const, code: "ingredient_archive_failed", message: archiveError.message, status: 500 };
      }

      return { ok: true as const, archived: true };
    };

    if (body.action === "create_category") {
      const name = body.name.trim();
      if (!name) {
        return fail("invalid_category_name", "Category name is required.", 422);
      }
      const ensured = await ensureProductCategory({
        supabase,
        tenantId: auth.tenantId!,
        branchId: scopedBranchId,
        name,
        userId: auth.userId
      });
      if (!ensured.ok) {
        return fail("category_create_failed", ensured.error.message ?? "Failed to create category.", 500);
      }
      return ok({ category: { name, productCount: 0 }, persisted: ensured.persisted });
    }

    if (body.action === "rename_category") {
      const oldName = body.old_name.trim();
      const name = body.name.trim();
      if (!oldName || !name) {
        return fail("invalid_category_name", "Both old_name and name are required.", 422);
      }
      const ensured = await ensureProductCategory({
        supabase,
        tenantId: auth.tenantId!,
        branchId: scopedBranchId,
        name,
        userId: auth.userId
      });
      if (!ensured.ok) {
        return fail("category_rename_failed", ensured.error.message ?? "Failed to rename category.", 500);
      }
      const productUpdate = await supabase
        .from("products")
        .update({ category: name })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .eq("category", oldName);
      if (productUpdate.error) {
        return fail("category_product_update_failed", productUpdate.error.message, 500);
      }
      const registryDelete = await supabase
        .from("product_categories")
        .delete()
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .eq("name", oldName);
      if (registryDelete.error && !isMissingTableError(registryDelete.error, "product_categories")) {
        return fail("category_old_registry_delete_failed", registryDelete.error.message, 500);
      }
      return ok({ category: { oldName, name } });
    }

    if (body.action === "delete_category") {
      const name = body.name.trim();
      if (!name) {
        return fail("invalid_category_name", "Category name is required.", 422);
      }
      const { count, error: productCountError } = await supabase
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .eq("category", name)
        .eq("is_active", true);
      if (productCountError) {
        return fail("category_product_count_failed", productCountError.message, 500);
      }
      if ((count ?? 0) > 0) {
        return fail("category_in_use", "Cannot delete a category that still has products.", 409);
      }
      const registryDelete = await supabase
        .from("product_categories")
        .delete()
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .eq("name", name);
      if (registryDelete.error && !isMissingTableError(registryDelete.error, "product_categories")) {
        return fail("category_delete_failed", registryDelete.error.message, 500);
      }
      return ok({ category: { name, deleted: true } });
    }

    if (body.action === "create_product_with_stock_setup") {
      const name = body.name?.trim();
      const category = body.category?.trim();
      const sku = normalizeSku(body.sku);
      const stockQuantity = Number(body.stock_quantity ?? 0);
      const storePrice = Number(body.store_price);
      const deliveryPrice = Number(body.delivery_price);
      const deliveryPriceByChannel = buildDeliveryPriceByChannel({
        deliveryPrice,
        deliveryPricesByChannel: body.delivery_prices_by_channel
      });
      const useIngredientRecipe = Boolean(body.use_ingredient_recipe);
      const isRecommended = Boolean(body.is_recommended);
      const ingredientLines = Array.isArray(body.ingredient_lines) ? body.ingredient_lines : [];

      if (!name || !category) {
        return fail("invalid_product_fields", "name and category are required.", 422);
      }
      if (!Number.isFinite(storePrice) || storePrice < 0) {
        return fail("invalid_store_price", "store_price must be greater than or equal to 0.", 422);
      }
      if (!Number.isFinite(deliveryPrice) || deliveryPrice < 0) {
        return fail("invalid_delivery_price", "delivery_price must be greater than or equal to 0.", 422);
      }
      for (const channel of DELIVERY_CHANNELS) {
        const channelPrice = Number(deliveryPriceByChannel[channel]);
        if (!Number.isFinite(channelPrice) || channelPrice < 0) {
          return fail("invalid_delivery_price", `delivery_prices_by_channel.${channel} must be greater than or equal to 0.`, 422);
        }
      }
      if (!Number.isFinite(stockQuantity) || stockQuantity < 0) {
        return fail("invalid_stock_quantity", "stock_quantity must be greater than or equal to 0.", 422);
      }

      const categoryEnsured = await ensureProductCategory({
        supabase,
        tenantId: auth.tenantId!,
        branchId: scopedBranchId,
        name: category,
        userId: auth.userId
      });
      if (!categoryEnsured.ok) {
        return fail("category_create_failed", categoryEnsured.error.message ?? "Failed to create category.", 500);
      }

      const normalizedRecipeLines = ingredientLines
        .map((line) => ({
          ingredient_id: String(line.ingredient_id ?? "").trim(),
          quantity: Number(line.quantity),
          quantity_unit: normalizeRecipeQuantityUnit(line.quantity_unit)
        }))
        .filter((line) => line.ingredient_id && Number.isFinite(line.quantity) && line.quantity > 0);

      if (useIngredientRecipe && normalizedRecipeLines.length === 0) {
        return fail("missing_recipe_lines", "Please select at least one ingredient line.", 422);
      }

      const { data: existingProductRows, error: existingProductByNameError } = await supabase
        .from("products")
        .select("id,sku,metadata")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .eq("name", name)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1);
      if (existingProductByNameError) {
        return fail("product_query_failed", existingProductByNameError.message, 500);
      }

      const existingProductByName = existingProductRows?.[0] as { id: string; sku?: string | null; metadata?: Record<string, unknown> | null } | undefined;
      const baseProductInsertPayload = {
        tenant_id: auth.tenantId!,
        branch_id: scopedBranchId,
        sku,
        name,
        category,
        price: Number(storePrice.toFixed(2)),
        is_active: true,
        metadata: withProductRecommendedMetadata(null, isRecommended)
      };

      const insertPayloadVariants = [
        { ...baseProductInsertPayload, sell_unit: "ชิ้น", stock_deduction_mode: "unit_only" as const },
        { ...baseProductInsertPayload, stock_deduction_mode: "unit_only" as const },
        { ...baseProductInsertPayload, sell_unit: "ชิ้น" },
        { ...baseProductInsertPayload }
      ];

      const reusedExistingProduct = Boolean(existingProductByName?.id);
      let productSku = String(existingProductByName?.sku ?? sku);
      let createdProductId: string | null = existingProductByName?.id ? String(existingProductByName.id) : null;
      let createdProductError: PostgrestLikeError | null = null;

      if (!createdProductId) {
        for (const payload of insertPayloadVariants) {
          const attempt = await supabase.from("products").insert(payload).select("id,sku").single();
          if (attempt.error) {
            createdProductError = attempt.error;
            continue;
          }
          createdProductId = String(attempt.data?.id ?? "");
          productSku = String((attempt.data as { sku?: string | null } | null)?.sku ?? sku);
          createdProductError = null;
          if (createdProductId) {
            break;
          }
        }

        if (createdProductError) {
          return fail("product_insert_failed", createdProductError.message ?? "Failed to insert product.", 500);
        }
      }
      if (!createdProductId) {
        return fail("product_insert_failed", "Product insert returned no data.", 500);
      }

      let createdFallbackIngredientId: string | null = null;

      try {
        if (reusedExistingProduct) {
          const updatePayloadCandidates = [
            {
              name,
              category,
              price: Number(storePrice.toFixed(2)),
              sell_unit: "ชิ้น",
              stock_deduction_mode: "recipe_deduction",
              is_active: true
            },
            {
              name,
              category,
              price: Number(storePrice.toFixed(2)),
              stock_deduction_mode: "recipe_deduction",
              is_active: true
            },
            {
              name,
              category,
              price: Number(storePrice.toFixed(2)),
              sell_unit: "ชิ้น",
              is_active: true
            },
            {
              name,
              category,
              price: Number(storePrice.toFixed(2)),
              is_active: true
            }
          ];

          const updatePayloadCandidatesWithMetadata = updatePayloadCandidates.map((candidate) => ({
            ...candidate,
            metadata: withProductRecommendedMetadata(existingProductByName?.metadata, isRecommended)
          }));

          let updateExistingProductError: PostgrestLikeError | null = null;
          for (const payload of updatePayloadCandidatesWithMetadata) {
            const result = await supabase
              .from("products")
              .update(payload)
              .eq("tenant_id", auth.tenantId!)
              .eq("branch_id", scopedBranchId)
              .eq("id", createdProductId);
            updateExistingProductError = result.error;
            if (!updateExistingProductError) break;
            const canRetry =
              isMissingSellUnitColumnError(updateExistingProductError) ||
              isMissingStockDeductionModeColumnError(updateExistingProductError);
            if (!canRetry) break;
          }
          if (updateExistingProductError) {
            throw new Error(updateExistingProductError.message ?? "Failed to update existing product.");
          }
        }

        const priceRows = DELIVERY_CHANNELS.map((channel) => ({
          tenant_id: auth.tenantId!,
          branch_id: scopedBranchId,
          product_id: createdProductId,
          channel,
          app_price: Number(deliveryPriceByChannel[channel].toFixed(2)),
          is_active: true,
          created_by: auth.userId,
          updated_by: auth.userId
        }));

        const { error: priceUpsertError } = await supabase
          .from("product_channel_prices")
          .upsert(priceRows, { onConflict: "tenant_id,branch_id,product_id,channel" });

        if (priceUpsertError && !isMissingTableError(priceUpsertError, "product_channel_prices")) {
          throw new Error(priceUpsertError.message);
        }

        if (useIngredientRecipe) {
          const ingredientIds = normalizedRecipeLines.map((line) => line.ingredient_id);
          const { data: ingredientRows, error: ingredientQueryError } = await supabase
            .from("ingredients")
            .select("id,base_unit")
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", scopedBranchId)
            .in("id", ingredientIds);

          if (ingredientQueryError) {
            throw new Error(ingredientQueryError.message);
          }

          const validIngredientIds = new Set((ingredientRows ?? []).map((row) => String(row.id)));
          const ingredientBaseUnitMap = new Map((ingredientRows ?? []).map((row) => [String(row.id), String((row as { base_unit?: string }).base_unit ?? "")]));
          for (const ingredientId of ingredientIds) {
            if (!validIngredientIds.has(ingredientId)) {
              throw new Error(`ingredient_not_found:${ingredientId}`);
            }
          }

          if (reusedExistingProduct) {
            const { error: clearRecipeError } = await supabase
              .from("recipes")
              .delete()
              .eq("tenant_id", auth.tenantId!)
              .eq("branch_id", scopedBranchId)
              .eq("product_id", createdProductId)
              .eq("applies_when_takeaway_only", false);
            if (clearRecipeError) {
              throw new Error(clearRecipeError.message);
            }
          }

          const recipeRows = normalizedRecipeLines.map((line) => ({
            tenant_id: auth.tenantId!,
            branch_id: scopedBranchId,
            product_id: createdProductId,
            ingredient_id: line.ingredient_id,
            quantity_per_item: toRecipeQuantityByIngredientBaseUnit({
              quantity: line.quantity,
              quantityUnit: line.quantity_unit,
              ingredientBaseUnit: ingredientBaseUnitMap.get(line.ingredient_id) ?? "gram"
            }),
            applies_when_takeaway_only: false
          }));

          const { error: recipeUpsertError } = await supabase
            .from("recipes")
            .upsert(recipeRows, { onConflict: "product_id,ingredient_id,applies_when_takeaway_only" });
          if (recipeUpsertError) {
            throw new Error(recipeUpsertError.message);
          }
        } else {
          const fallbackIngredientName = `STOCK:${productSku}:${name}`.slice(0, 120);
          const { data: existingFallbackRows, error: existingFallbackError } = await supabase
            .from("recipes")
            .select("ingredient_id,ingredients(name)")
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", scopedBranchId)
            .eq("product_id", createdProductId)
            .eq("applies_when_takeaway_only", false);
          if (existingFallbackError) {
            throw new Error(existingFallbackError.message);
          }

          const existingFallbackRecipe = (existingFallbackRows ?? []).find((row) => {
            const ingredientRecord = Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients;
            return String(ingredientRecord?.name ?? "").startsWith(FALLBACK_INGREDIENT_PREFIX);
          });
          let fallbackIngredientId = existingFallbackRecipe ? String(existingFallbackRecipe.ingredient_id) : "";

          if (fallbackIngredientId) {
            const { error: fallbackIngredientUpdateError } = await supabase
              .from("ingredients")
              .update({
                name: fallbackIngredientName,
                base_unit: "piece",
                quantity_on_hand: round3(stockQuantity),
                reorder_level: 0
              })
              .eq("tenant_id", auth.tenantId!)
              .eq("branch_id", scopedBranchId)
              .eq("id", fallbackIngredientId);
            if (fallbackIngredientUpdateError) {
              throw new Error(fallbackIngredientUpdateError.message);
            }
          } else {
            const { data: fallbackIngredient, error: fallbackIngredientError } = await supabase
              .from("ingredients")
              .insert({
                tenant_id: auth.tenantId!,
                branch_id: scopedBranchId,
                name: fallbackIngredientName,
                base_unit: "piece",
                quantity_on_hand: round3(stockQuantity),
                reorder_level: 0
              })
              .select("id")
              .single();

            if (fallbackIngredientError) {
              throw new Error(fallbackIngredientError.message);
            }

            fallbackIngredientId = String(fallbackIngredient.id);
            createdFallbackIngredientId = fallbackIngredientId;
          }

          if (reusedExistingProduct) {
            const { error: clearRecipeError } = await supabase
              .from("recipes")
              .delete()
              .eq("tenant_id", auth.tenantId!)
              .eq("branch_id", scopedBranchId)
              .eq("product_id", createdProductId)
              .eq("applies_when_takeaway_only", false);
            if (clearRecipeError) {
              throw new Error(clearRecipeError.message);
            }
          }

          const { error: fallbackRecipeError } = await supabase.from("recipes").upsert(
            {
              tenant_id: auth.tenantId!,
              branch_id: scopedBranchId,
              product_id: createdProductId,
              ingredient_id: fallbackIngredientId,
              quantity_per_item: 1,
              applies_when_takeaway_only: false
            },
            { onConflict: "product_id,ingredient_id,applies_when_takeaway_only" }
          );

          if (fallbackRecipeError) {
            throw new Error(fallbackRecipeError.message);
          }
        }

        const { error: setModeError } = await supabase
          .from("products")
          .update({ stock_deduction_mode: "recipe_deduction" })
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", scopedBranchId)
          .eq("id", createdProductId);
        if (setModeError && !isMissingStockDeductionModeColumnError(setModeError)) {
          throw new Error(setModeError.message);
        }

        let { data: finalProduct, error: finalProductError } = await supabase
          .from("products")
          .select(PRODUCT_SELECT)
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", scopedBranchId)
          .eq("id", createdProductId)
          .single();
        if (finalProductError && isMissingStockDeductionModeColumnError(finalProductError)) {
          const retry = await supabase
            .from("products")
            .select("id,sku,name,category,price,is_active,updated_at")
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", scopedBranchId)
            .eq("id", createdProductId)
            .single();
          finalProduct = retry.data ? { ...retry.data, stock_deduction_mode: "recipe_deduction", metadata: null } : null;
          finalProductError = retry.error;
        }
        if (finalProductError) {
          throw new Error(finalProductError.message);
        }

        return ok(
          {
            product: finalProduct,
            reused_existing_product: reusedExistingProduct,
            stock_tracking: useIngredientRecipe ? "ingredient_recipe" : "unit_piece_recipe_bridge",
            recipe_lines_count: useIngredientRecipe ? normalizedRecipeLines.length : 1
          },
          reusedExistingProduct ? 200 : 201
        );
      } catch (workflowError) {
        if (!reusedExistingProduct) {
          await supabase
            .from("products")
            .delete()
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", scopedBranchId)
            .eq("id", createdProductId);
        }

        if (createdFallbackIngredientId) {
          await supabase
            .from("ingredients")
            .delete()
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", scopedBranchId)
            .eq("id", createdFallbackIngredientId);
        }

        return fail(
          "create_product_with_stock_setup_failed",
          workflowError instanceof Error ? workflowError.message : "Unknown workflow error",
          500
        );
      }
    }

    if (body.action === "update_product_with_stock_setup") {
      const productId = String(body.product_id ?? "").trim();
      const name = body.name?.trim();
      const category = body.category?.trim();
      const stockQuantity = Number(body.stock_quantity ?? 0);
      const storePrice = Number(body.store_price);
      const deliveryPrice = Number(body.delivery_price);
      const deliveryPriceByChannel = buildDeliveryPriceByChannel({
        deliveryPrice,
        deliveryPricesByChannel: body.delivery_prices_by_channel
      });
      const useIngredientRecipe = Boolean(body.use_ingredient_recipe);
      const customerIngredientSelectionEnabled =
        useIngredientRecipe && Boolean(body.customer_ingredient_selection_enabled);
      const isRecommended = Boolean(body.is_recommended);
      const ingredientLines = Array.isArray(body.ingredient_lines) ? body.ingredient_lines : [];

      if (!productId) {
        return fail("invalid_product_id", "product_id is required.", 422);
      }
      if (!name || !category) {
        return fail("invalid_product_fields", "name and category are required.", 422);
      }
      if (!Number.isFinite(storePrice) || storePrice < 0) {
        return fail("invalid_store_price", "store_price must be greater than or equal to 0.", 422);
      }
      if (!Number.isFinite(deliveryPrice) || deliveryPrice < 0) {
        return fail("invalid_delivery_price", "delivery_price must be greater than or equal to 0.", 422);
      }
      for (const channel of DELIVERY_CHANNELS) {
        const channelPrice = Number(deliveryPriceByChannel[channel]);
        if (!Number.isFinite(channelPrice) || channelPrice < 0) {
          return fail("invalid_delivery_price", `delivery_prices_by_channel.${channel} must be greater than or equal to 0.`, 422);
        }
      }
      if (!Number.isFinite(stockQuantity) || stockQuantity < 0) {
        return fail("invalid_stock_quantity", "stock_quantity must be greater than or equal to 0.", 422);
      }

      let productBranchId = scopedBranchId;
      let existingProduct: { id: string; sku: string; branch_id: string; metadata?: Record<string, unknown> | null } | null = null;
      const { data: scopedProduct, error: scopedProductError } = await supabase
        .from("products")
        .select("id,sku,branch_id,metadata")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .eq("id", productId)
        .maybeSingle<{ id: string; sku: string; branch_id: string; metadata?: Record<string, unknown> | null }>();
      if (scopedProductError) {
        return fail("product_query_failed", scopedProductError.message, 500);
      }
      if (scopedProduct) {
        existingProduct = scopedProduct;
        productBranchId = String(scopedProduct.branch_id);
      } else {
        const { data: tenantProduct, error: tenantProductError } = await supabase
          .from("products")
          .select("id,sku,branch_id,metadata")
          .eq("tenant_id", auth.tenantId!)
          .eq("id", productId)
          .maybeSingle<{ id: string; sku: string; branch_id: string; metadata?: Record<string, unknown> | null }>();
        if (tenantProductError) {
          return fail("product_query_failed", tenantProductError.message, 500);
        }
        if (!tenantProduct || !canManageCatalogRole(auth.branchRole)) {
          return fail("product_not_found", "Product not found in this branch.", 404);
        }
        existingProduct = tenantProduct;
        productBranchId = String(tenantProduct.branch_id);
      }

      const categoryEnsured = await ensureProductCategory({
        supabase,
        tenantId: auth.tenantId!,
        branchId: productBranchId,
        name: category,
        userId: auth.userId
      });
      if (!categoryEnsured.ok) {
        return fail("category_create_failed", categoryEnsured.error.message ?? "Failed to create category.", 500);
      }

      const normalizedRecipeLines = ingredientLines
        .map((line) => ({
          ingredient_id: String(line.ingredient_id ?? "").trim(),
          quantity: Number(line.quantity),
          quantity_unit: normalizeRecipeQuantityUnit(line.quantity_unit)
        }))
        .filter((line) => line.ingredient_id && Number.isFinite(line.quantity) && line.quantity > 0);

      if (useIngredientRecipe && normalizedRecipeLines.length === 0) {
        return fail("missing_recipe_lines", "Please select at least one ingredient line.", 422);
      }

      const updatePayloadCandidates = [
        {
          name,
          category,
          price: Number(storePrice.toFixed(2)),
          sell_unit: "ชิ้น",
          stock_deduction_mode: "recipe_deduction",
          is_active: true
        },
        {
          name,
          category,
          price: Number(storePrice.toFixed(2)),
          stock_deduction_mode: "recipe_deduction",
          is_active: true
        },
        {
          name,
          category,
          price: Number(storePrice.toFixed(2)),
          sell_unit: "ชิ้น",
          is_active: true
        },
        {
          name,
          category,
          price: Number(storePrice.toFixed(2)),
          is_active: true
        }
      ];

      const updatePayloadCandidatesWithCustomerSelection = updatePayloadCandidates.map((candidate) => ({
        ...candidate,
        customer_ingredient_selection_enabled: customerIngredientSelectionEnabled,
        metadata: withProductRecommendedMetadata(existingProduct?.metadata, isRecommended)
      }));

      let updateProductError: PostgrestLikeError | null = null;
      for (let i = 0; i < updatePayloadCandidatesWithCustomerSelection.length; i += 1) {
        const result = await supabase
          .from("products")
          .update(updatePayloadCandidatesWithCustomerSelection[i])
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", productBranchId)
          .eq("id", productId);

        updateProductError = result.error;
        if (!updateProductError) break;
        const canRetry =
          isMissingSellUnitColumnError(updateProductError) || isMissingStockDeductionModeColumnError(updateProductError);
        if (!canRetry) break;
      }
      if (updateProductError) {
        return fail("product_update_failed", updateProductError.message ?? "Failed to update product.", 500);
      }

      const priceRows = DELIVERY_CHANNELS.map((channel) => ({
        tenant_id: auth.tenantId!,
        branch_id: productBranchId,
        product_id: productId,
        channel,
        app_price: Number(deliveryPriceByChannel[channel].toFixed(2)),
        is_active: true,
        created_by: auth.userId,
        updated_by: auth.userId
      }));
      const { error: priceUpsertError } = await supabase
        .from("product_channel_prices")
        .upsert(priceRows, { onConflict: "tenant_id,branch_id,product_id,channel" });
      if (priceUpsertError && !isMissingTableError(priceUpsertError, "product_channel_prices")) {
        return fail("delivery_price_upsert_failed", priceUpsertError.message, 500);
      }

      const { data: existingRecipes, error: existingRecipesError } = await supabase
        .from("recipes")
        .select("ingredient_id,ingredients(name)")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", productBranchId)
        .eq("product_id", productId);
      if (existingRecipesError) {
        return fail("recipe_query_failed", existingRecipesError.message, 500);
      }

      const fallbackIngredientIds = new Set<string>();
      for (const row of existingRecipes ?? []) {
        const ingredientRecord = Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients;
        const ingredientName = String(ingredientRecord?.name ?? "");
        if (ingredientName.startsWith(FALLBACK_INGREDIENT_PREFIX)) {
          fallbackIngredientIds.add(String(row.ingredient_id));
        }
      }

      if (useIngredientRecipe) {
        const ingredientIds = normalizedRecipeLines.map((line) => line.ingredient_id);
        const { data: ingredientRows, error: ingredientQueryError } = await supabase
          .from("ingredients")
          .select("id,base_unit")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", productBranchId)
          .in("id", ingredientIds);
        if (ingredientQueryError) {
          return fail("ingredient_query_failed", ingredientQueryError.message, 500);
        }
        const validIds = new Set((ingredientRows ?? []).map((row) => String(row.id)));
        const ingredientBaseUnitMap = new Map((ingredientRows ?? []).map((row) => [String(row.id), String((row as { base_unit?: string }).base_unit ?? "")]));
        for (const ingredientId of ingredientIds) {
          if (!validIds.has(ingredientId)) {
            return fail("ingredient_not_found", `Ingredient not found: ${ingredientId}`, 422);
          }
        }

        const recipeRows = normalizedRecipeLines.map((line) => ({
          tenant_id: auth.tenantId!,
          branch_id: productBranchId,
          product_id: productId,
          ingredient_id: line.ingredient_id,
          quantity_per_item: toRecipeQuantityByIngredientBaseUnit({
            quantity: line.quantity,
            quantityUnit: line.quantity_unit,
            ingredientBaseUnit: ingredientBaseUnitMap.get(line.ingredient_id) ?? "gram"
          }),
          applies_when_takeaway_only: false
        }));

        const { error: recipeUpsertError } = await supabase
          .from("recipes")
          .upsert(recipeRows, { onConflict: "product_id,ingredient_id,applies_when_takeaway_only" });
        if (recipeUpsertError) {
          return fail("recipe_upsert_failed", recipeUpsertError.message, 500);
        }

        const ingredientToKeep = new Set(ingredientIds);
        for (const fallbackIngredientId of fallbackIngredientIds) {
          ingredientToKeep.delete(fallbackIngredientId);
        }

        const { data: deleteCandidates, error: deleteCandidatesError } = await supabase
          .from("recipes")
          .select("ingredient_id")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", productBranchId)
          .eq("product_id", productId)
          .eq("applies_when_takeaway_only", false);
        if (deleteCandidatesError) {
          return fail("recipe_query_failed", deleteCandidatesError.message, 500);
        }

        for (const candidate of deleteCandidates ?? []) {
          const ingredientId = String(candidate.ingredient_id);
          if (ingredientToKeep.has(ingredientId)) continue;
          const { error: deleteRecipeError } = await supabase
            .from("recipes")
            .delete()
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", productBranchId)
            .eq("product_id", productId)
            .eq("ingredient_id", ingredientId)
            .eq("applies_when_takeaway_only", false);
          if (deleteRecipeError) {
            return fail("recipe_delete_failed", deleteRecipeError.message, 500);
          }
        }

        for (const fallbackIngredientId of fallbackIngredientIds) {
          await supabase
            .from("ingredients")
            .delete()
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", productBranchId)
            .eq("id", fallbackIngredientId);
        }
      } else {
        let fallbackIngredientId = Array.from(fallbackIngredientIds)[0] ?? "";
        const fallbackIngredientName = `STOCK:${existingProduct.sku}:${name}`.slice(0, 120);

        if (!fallbackIngredientId) {
          const { data: fallbackIngredient, error: fallbackIngredientError } = await supabase
            .from("ingredients")
            .insert({
              tenant_id: auth.tenantId!,
              branch_id: productBranchId,
              name: fallbackIngredientName,
              base_unit: "piece",
              quantity_on_hand: round3(stockQuantity),
              reorder_level: 0
            })
            .select("id")
            .single();
          if (fallbackIngredientError) {
            return fail("ingredient_insert_failed", fallbackIngredientError.message, 500);
          }
          fallbackIngredientId = String(fallbackIngredient.id);
        } else {
          const { error: fallbackIngredientUpdateError } = await supabase
            .from("ingredients")
            .update({
              name: fallbackIngredientName,
              base_unit: "piece",
              quantity_on_hand: round3(stockQuantity),
              reorder_level: 0
            })
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", productBranchId)
            .eq("id", fallbackIngredientId);
          if (fallbackIngredientUpdateError) {
            return fail("ingredient_update_failed", fallbackIngredientUpdateError.message, 500);
          }
        }

        const { error: clearRecipeError } = await supabase
          .from("recipes")
          .delete()
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", productBranchId)
          .eq("product_id", productId)
          .eq("applies_when_takeaway_only", false);
        if (clearRecipeError) {
          return fail("recipe_delete_failed", clearRecipeError.message, 500);
        }

        const { error: fallbackRecipeUpsertError } = await supabase.from("recipes").upsert(
          {
            tenant_id: auth.tenantId!,
            branch_id: productBranchId,
            product_id: productId,
            ingredient_id: fallbackIngredientId,
            quantity_per_item: 1,
            applies_when_takeaway_only: false
          },
          { onConflict: "product_id,ingredient_id,applies_when_takeaway_only" }
        );
        if (fallbackRecipeUpsertError) {
          return fail("recipe_upsert_failed", fallbackRecipeUpsertError.message, 500);
        }
      }

      let { data: finalProduct, error: finalProductError } = await supabase
        .from("products")
        .select(PRODUCT_SELECT)
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", productBranchId)
        .eq("id", productId)
        .single();
      if (finalProductError && isMissingStockDeductionModeColumnError(finalProductError)) {
        const retry = await supabase
            .from("products")
            .select("id,sku,name,category,price,is_active,updated_at")
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", productBranchId)
            .eq("id", productId)
          .single();
        finalProduct = retry.data ? { ...retry.data, stock_deduction_mode: "recipe_deduction", metadata: null } : null;
        finalProductError = retry.error;
      }
      if (finalProductError) {
        return fail("product_query_failed", finalProductError.message, 500);
      }

      return ok({
        product: finalProduct,
        stock_tracking: useIngredientRecipe ? "ingredient_recipe" : "unit_piece_recipe_bridge",
        recipe_lines_count: useIngredientRecipe ? normalizedRecipeLines.length : 1
      });
    }

    if (body.action === "deactivate_product") {
      const productId = String(body.product_id ?? "").trim();
      if (!productId) {
        return fail("invalid_product_id", "product_id is required.", 422);
      }

      const { data, error } = await softDeleteProducts({
        supabase,
        tenantId: auth.tenantId!,
        branchId: scopedBranchId,
        productIds: [productId],
        userId: auth.userId,
        reason: "single_product_deactivate"
      });
      if (error) {
        return fail("product_deactivate_failed", error.message, 500);
      }
      if (!data || data.length === 0) {
        return fail("product_not_found", "Product not found in this branch.", 404);
      }
      return ok({ id: productId, trashed: true });
    }

    if (body.action === "bulk_deactivate_products") {
      const productIds = Array.from(
        new Set((Array.isArray(body.product_ids) ? body.product_ids : []).map((id) => String(id ?? "").trim()).filter(Boolean))
      );
      if (productIds.length === 0) {
        return fail("invalid_product_ids", "product_ids must include at least one product id.", 422);
      }

      const { data, error } = await softDeleteProducts({
        supabase,
        tenantId: auth.tenantId!,
        branchId: scopedBranchId,
        productIds,
        userId: auth.userId,
        reason: "bulk_product_deactivate"
      });
      if (error) {
        return fail("product_bulk_deactivate_failed", error.message, 500);
      }

      return ok({
        updated_count: data?.length ?? 0,
        trashed_count: data?.length ?? 0
      });
    }

    if (body.action === "bulk_unlink_product_recipes") {
      const productIds = Array.from(
        new Set((Array.isArray(body.product_ids) ? body.product_ids : []).map((id) => String(id ?? "").trim()).filter(Boolean))
      );
      if (productIds.length === 0) {
        return fail("invalid_product_ids", "product_ids must include at least one product id.", 422);
      }

      const stockQuantityRaw = Number(body.stock_quantity ?? 0);
      const stockQuantity = Number.isFinite(stockQuantityRaw) ? Math.max(0, Math.trunc(stockQuantityRaw)) : 0;

      const { data: productRows, error: productRowsError } = await supabase
        .from("products")
        .select("id,sku,name")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .in("id", productIds);
      if (productRowsError) {
        return fail("products_query_failed", productRowsError.message, 500);
      }

      const foundProducts = (productRows ?? []).map((row) => ({
        id: String(row.id),
        sku: String(row.sku ?? ""),
        name: String(row.name ?? "")
      }));
      if (foundProducts.length === 0) {
        return fail("product_not_found", "Product not found in this branch.", 404);
      }

      let updatedCount = 0;
      const failed: Array<{ product_id: string; message: string }> = [];

      for (const product of foundProducts) {
        try {
          const fallbackIngredientName = `STOCK:${product.sku}:${product.name}`.slice(0, 120);

          const { data: existingFallback, error: existingFallbackError } = await supabase
            .from("ingredients")
            .select("id")
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", scopedBranchId)
            .eq("name", fallbackIngredientName)
            .maybeSingle();
          if (existingFallbackError) throw existingFallbackError;

          let fallbackIngredientId = existingFallback?.id ? String(existingFallback.id) : "";
          if (!fallbackIngredientId) {
            const { data: fallbackIngredient, error: fallbackIngredientError } = await supabase
              .from("ingredients")
              .insert({
                tenant_id: auth.tenantId!,
                branch_id: scopedBranchId,
                name: fallbackIngredientName,
                base_unit: "piece",
                quantity_on_hand: stockQuantity,
                reorder_level: 0
              })
              .select("id")
              .single();
            if (fallbackIngredientError) throw fallbackIngredientError;
            fallbackIngredientId = String(fallbackIngredient.id);
          } else {
            const { error: fallbackUpdateError } = await supabase
              .from("ingredients")
              .update({
                quantity_on_hand: stockQuantity,
                base_unit: "piece",
                updated_at: new Date().toISOString()
              })
              .eq("tenant_id", auth.tenantId!)
              .eq("branch_id", scopedBranchId)
              .eq("id", fallbackIngredientId);
            if (fallbackUpdateError) throw fallbackUpdateError;
          }

          const { error: deleteRecipesError } = await supabase
            .from("recipes")
            .delete()
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", scopedBranchId)
            .eq("product_id", product.id);
          if (deleteRecipesError) throw deleteRecipesError;

          const { error: fallbackRecipeError } = await supabase.from("recipes").upsert(
            {
              tenant_id: auth.tenantId!,
              branch_id: scopedBranchId,
              product_id: product.id,
              ingredient_id: fallbackIngredientId,
              quantity_per_item: 1,
              applies_when_takeaway_only: false
            },
            { onConflict: "product_id,ingredient_id,applies_when_takeaway_only" }
          );
          if (fallbackRecipeError) throw fallbackRecipeError;

          const { error: productUpdateError } = await supabase
            .from("products")
            .update({ stock_deduction_mode: "unit_only", updated_at: new Date().toISOString() })
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", scopedBranchId)
            .eq("id", product.id);
          if (productUpdateError && !isMissingStockDeductionModeColumnError(productUpdateError)) throw productUpdateError;

          updatedCount += 1;
        } catch (error) {
          failed.push({ product_id: product.id, message: error instanceof Error ? error.message : "Unknown error" });
        }
      }

      return ok({
        updated_count: updatedCount,
        skipped_count: productIds.length - foundProducts.length,
        failed_count: failed.length,
        failed
      });
    }

    if (body.action === "upsert_product") {
      const sku = normalizeSku(body.sku);
      const name = body.name?.trim();
      const category = body.category?.trim();
      const stockMode = body.stock_deduction_mode ?? "unit_only";
      const price = Number(body.price);
      const isRecommended = Boolean(body.is_recommended);

      if (!sku || !name || !category) {
        return fail("invalid_product_fields", "sku, name and category are required.", 422);
      }
      if (!Number.isFinite(price) || price < 0) {
        return fail("invalid_product_price", "price must be greater than or equal to 0.", 422);
      }
      if (!["unit_only", "recipe_deduction"].includes(stockMode)) {
        return fail("invalid_stock_mode", "stock_deduction_mode is invalid.", 422);
      }

      const categoryEnsured = await ensureProductCategory({
        supabase,
        tenantId: auth.tenantId!,
        branchId: scopedBranchId,
        name: category,
        userId: auth.userId
      });
      if (!categoryEnsured.ok) {
        return fail("category_create_failed", categoryEnsured.error.message ?? "Failed to create category.", 500);
      }

      if (stockMode === "recipe_deduction") {
        if (!body.id?.trim()) {
          return fail(
            "recipe_required_for_mode",
            "Please create the product first, then add at least one recipe line before switching to recipe_deduction mode.",
            422
          );
        }
        const { count: recipeCount, error: recipeCountError } = await supabase
          .from("recipes")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", scopedBranchId)
          .eq("product_id", body.id.trim());
        if (recipeCountError) {
          return fail("recipe_count_query_failed", recipeCountError.message, 500);
        }
        if ((recipeCount ?? 0) <= 0) {
          return fail(
            "recipe_required_for_mode",
            "Cannot switch to recipe_deduction mode because this product has no recipe lines yet.",
            422
          );
        }
      }

      const payload = {
        tenant_id: auth.tenantId!,
        branch_id: scopedBranchId,
        sku,
        name,
        category,
        price: Number(price.toFixed(2)),
        sell_unit: "ชิ้น",
        stock_deduction_mode: stockMode,
        is_active: body.is_active ?? true,
        metadata: withProductRecommendedMetadata(null, isRecommended)
      };
      const payloadWithoutSellUnit = {
        tenant_id: auth.tenantId!,
        branch_id: scopedBranchId,
        sku,
        name,
        category,
        price: Number(price.toFixed(2)),
        stock_deduction_mode: stockMode,
        is_active: body.is_active ?? true,
        metadata: withProductRecommendedMetadata(null, isRecommended)
      };
      const payloadWithoutStockDeductionMode = {
        tenant_id: auth.tenantId!,
        branch_id: scopedBranchId,
        sku,
        name,
        category,
        price: Number(price.toFixed(2)),
        sell_unit: "ชิ้น",
        is_active: body.is_active ?? true,
        metadata: withProductRecommendedMetadata(null, isRecommended)
      };
      const legacyPayload = {
        tenant_id: auth.tenantId!,
        branch_id: scopedBranchId,
        sku,
        name,
        category,
        price: Number(price.toFixed(2)),
        is_active: body.is_active ?? true,
        metadata: withProductRecommendedMetadata(null, isRecommended)
      };
      const LEGACY_PRODUCT_SELECT = "id,sku,name,category,price,is_active,updated_at";

      if (body.id?.trim()) {
        let { data, error } = await supabase
          .from("products")
          .update(payload)
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", scopedBranchId)
          .eq("id", body.id.trim())
          .select(PRODUCT_SELECT)
          .maybeSingle();

        if (error && (isMissingSellUnitColumnError(error) || isMissingStockDeductionModeColumnError(error))) {
          const missingSellUnit = isMissingSellUnitColumnError(error);
          const missingStockMode = isMissingStockDeductionModeColumnError(error);
          const retryPayload = missingSellUnit && missingStockMode
            ? legacyPayload
            : missingSellUnit
              ? payloadWithoutSellUnit
              : payloadWithoutStockDeductionMode;
          const retrySelect = missingStockMode ? LEGACY_PRODUCT_SELECT : PRODUCT_SELECT;
          const retry = (await supabase
            .from("products")
            .update(retryPayload)
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", scopedBranchId)
            .eq("id", body.id.trim())
            .select(retrySelect)
            .maybeSingle()) as { data: Record<string, unknown> | null; error: typeof error };
          if (missingStockMode && retry.data) {
            data = { ...retry.data, stock_deduction_mode: stockMode } as typeof data;
          } else {
            data = retry.data as typeof data;
          }
          error = retry.error;
        }

        if (error) {
          return fail("product_update_failed", error.message, 500);
        }
        if (!data) {
          return fail("product_not_found", "Product not found in this branch.", 404);
        }
        return ok(data);
      }

      let { data, error } = await supabase
        .from("products")
        .insert(payload)
        .select(PRODUCT_SELECT)
        .single();
      if (error && (isMissingSellUnitColumnError(error) || isMissingStockDeductionModeColumnError(error))) {
        const missingSellUnit = isMissingSellUnitColumnError(error);
        const missingStockMode = isMissingStockDeductionModeColumnError(error);
        const retryPayload = missingSellUnit && missingStockMode
          ? legacyPayload
          : missingSellUnit
            ? payloadWithoutSellUnit
            : payloadWithoutStockDeductionMode;
        const retrySelect = missingStockMode ? LEGACY_PRODUCT_SELECT : PRODUCT_SELECT;
        const retry = (await supabase.from("products").insert(retryPayload).select(retrySelect).single()) as {
          data: Record<string, unknown> | null;
          error: typeof error;
        };
        if (missingStockMode && retry.data) {
          data = { ...retry.data, stock_deduction_mode: stockMode } as typeof data;
        } else {
          data = retry.data as typeof data;
        }
        error = retry.error;
      }
      if (error) {
        return fail("product_insert_failed", error.message, 500);
      }
      return ok(data, 201);
    }

    if (body.action === "upsert_ingredient") {
      const name = body.name?.trim();
      const baseUnit = body.base_unit?.trim();
      const reorderLevel = Number(body.reorder_level ?? 0);
      const quantityOnHand = Number(body.quantity_on_hand ?? 0);
      const avgUnitCost = Number(body.avg_unit_cost ?? 0);
      const normalizedBaseUnit = String(baseUnit ?? "").toLowerCase();
      const shouldStoreAsIntegerGrams = normalizedBaseUnit === "gram" || normalizedBaseUnit === "g";
      const normalizedReorderLevel = shouldStoreAsIntegerGrams ? toIntegerGrams(reorderLevel) : round3(reorderLevel);
      const normalizedQuantityOnHand = shouldStoreAsIntegerGrams ? toIntegerGrams(quantityOnHand) : round3(quantityOnHand);

      if (!name || !baseUnit) {
        return fail("invalid_ingredient_fields", "name and base_unit are required.", 422);
      }
      if (!Number.isFinite(reorderLevel) || reorderLevel < 0) {
        return fail("invalid_reorder_level", "reorder_level must be greater than or equal to 0.", 422);
      }
      if (!Number.isFinite(quantityOnHand) || quantityOnHand < 0) {
        return fail("invalid_quantity_on_hand", "quantity_on_hand must be greater than or equal to 0.", 422);
      }
      if (!Number.isFinite(avgUnitCost) || avgUnitCost < 0) {
        return fail("invalid_avg_unit_cost", "avg_unit_cost must be greater than or equal to 0.", 422);
      }

      const payload = {
        tenant_id: auth.tenantId!,
        branch_id: scopedBranchId,
        name,
        base_unit: baseUnit,
        reorder_level: normalizedReorderLevel,
        quantity_on_hand: normalizedQuantityOnHand,
        avg_unit_cost: round4(avgUnitCost)
      };
      const legacyPayload = {
        tenant_id: auth.tenantId!,
        branch_id: scopedBranchId,
        name,
        base_unit: baseUnit,
        reorder_level: normalizedReorderLevel,
        quantity_on_hand: normalizedQuantityOnHand
      };

      if (body.id?.trim()) {
        const { data, error } = await supabase
          .from("ingredients")
          .update(payload)
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", scopedBranchId)
          .eq("id", body.id.trim())
          .select("id,name,base_unit,quantity_on_hand,reorder_level,avg_unit_cost,last_purchase_unit_cost,updated_at")
          .maybeSingle();
        if (error && isMissingIngredientCostColumnsError(error)) {
          const legacy = await supabase
            .from("ingredients")
            .update(legacyPayload)
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", scopedBranchId)
            .eq("id", body.id.trim())
            .select("id,name,base_unit,quantity_on_hand,reorder_level,updated_at")
            .maybeSingle();
          if (legacy.error) {
            return fail("ingredient_update_failed", legacy.error.message, 500);
          }
          if (!legacy.data) {
            return fail("ingredient_not_found", "Ingredient not found in this branch.", 404);
          }
          return ok({ ...legacy.data, avg_unit_cost: 0, last_purchase_unit_cost: 0 });
        }
        if (error) {
          return fail("ingredient_update_failed", error.message, 500);
        }
        if (!data) {
          return fail("ingredient_not_found", "Ingredient not found in this branch.", 404);
        }
        return ok(data);
      }

      const { data, error } = await supabase
        .from("ingredients")
        .insert(payload)
        .select("id,name,base_unit,quantity_on_hand,reorder_level,avg_unit_cost,last_purchase_unit_cost,updated_at")
        .single();
      if (error && isMissingIngredientCostColumnsError(error)) {
        const legacy = await supabase
          .from("ingredients")
          .insert(legacyPayload)
          .select("id,name,base_unit,quantity_on_hand,reorder_level,updated_at")
          .single();
        if (legacy.error) {
          return fail("ingredient_insert_failed", legacy.error.message, 500);
        }
        return ok({ ...legacy.data, avg_unit_cost: 0, last_purchase_unit_cost: 0 }, 201);
      }
      if (error) {
        return fail("ingredient_insert_failed", error.message, 500);
      }
      return ok(data, 201);
    }

    if (body.action === "add_ingredient_stock") {
      const ingredientId = body.ingredient_id?.trim();
      const ingredientName = String(body.ingredient_name ?? "").trim();
      const explicitBaseUnit = String(body.base_unit ?? "").trim();
      const legacyQuantityDelta = Number(body.quantity_delta);
      const purchaseQuantity = Number(body.purchase_quantity);
      const purchaseUnit = body.purchase_unit;
      const weightPerBagInGrams = Number(body.weight_per_bag_in_grams);
      const reason = body.reason?.trim() || "Purchase restock";
      const receivedTotalCost = Number(body.received_total_cost ?? 0);
      if (!ingredientId && !ingredientName) {
        return fail("invalid_ingredient_identity", "ingredient_id or ingredient_name is required.", 422);
      }
      if (!Number.isFinite(receivedTotalCost) || receivedTotalCost < 0) {
        return fail("invalid_received_total_cost", "received_total_cost must be greater than or equal to 0.", 422);
      }

      let resolvedIngredientId = ingredientId ?? "";
      if (!resolvedIngredientId && ingredientName) {
        const { data: existingIngredient, error: existingIngredientError } = await supabase
          .from("ingredients")
          .select("id")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", scopedBranchId)
          .eq("name", ingredientName)
          .maybeSingle<{ id: string }>();
        if (existingIngredientError) {
          return fail("ingredient_query_failed", existingIngredientError.message, 500);
        }

        if (existingIngredient) {
          resolvedIngredientId = String(existingIngredient.id);
        } else {
          const normalizedPurchaseUnit = String(purchaseUnit ?? "").trim().toLowerCase();
          const nextBaseUnit = explicitBaseUnit || (["piece", "unit", "ลูก"].includes(normalizedPurchaseUnit) ? "piece" : "gram");
          const { data: createdIngredient, error: createdIngredientError } = await supabase
            .from("ingredients")
            .insert({
              tenant_id: auth.tenantId!,
              branch_id: scopedBranchId,
              name: ingredientName,
              base_unit: nextBaseUnit,
              quantity_on_hand: 0,
              reorder_level: 0
            })
            .select("id")
            .single<{ id: string }>();
          if (createdIngredientError) {
            return fail("ingredient_insert_failed", createdIngredientError.message, 500);
          }
          resolvedIngredientId = String(createdIngredient.id);
        }
      }

      const { data: ingredientWithCost, error: ingredientWithCostError } = await supabase
        .from("ingredients")
        .select("id,base_unit,quantity_on_hand,avg_unit_cost")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .eq("id", resolvedIngredientId)
        .maybeSingle<{ id: string; base_unit: string; quantity_on_hand: number; avg_unit_cost: number }>();

      let ingredient: { id: string; base_unit: string; quantity_on_hand: number; avg_unit_cost: number } | null = ingredientWithCost;

      if (ingredientWithCostError && isMissingIngredientCostColumnsError(ingredientWithCostError)) {
        const legacyIngredient = await supabase
          .from("ingredients")
          .select("id,base_unit,quantity_on_hand")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", scopedBranchId)
          .eq("id", resolvedIngredientId)
          .maybeSingle<{ id: string; base_unit: string; quantity_on_hand: number }>();
        if (legacyIngredient.error) {
          return fail("ingredient_query_failed", legacyIngredient.error.message, 500);
        }
        if (!legacyIngredient.data) {
          return fail("ingredient_not_found", "Ingredient not found in this branch.", 404);
        }
        ingredient = { ...legacyIngredient.data, avg_unit_cost: 0 };
      } else if (ingredientWithCostError) {
        return fail("ingredient_query_failed", ingredientWithCostError.message, 500);
      }

      if (!ingredient) {
        return fail("ingredient_not_found", "Ingredient not found in this branch.", 404);
      }

      let quantityDelta = 0;
      try {
        if (Number.isFinite(purchaseQuantity) && purchaseQuantity > 0 && purchaseUnit) {
          if (isPieceBaseUnit(ingredient.base_unit)) {
            const pieceUnit = String(purchaseUnit).trim().toLowerCase();
            if (!["piece", "unit", "ลูก"].includes(pieceUnit)) {
              return fail("invalid_piece_purchase_unit", "Piece ingredients accept purchase unit: piece only.", 422);
            }
            quantityDelta = toIntegerGrams(purchaseQuantity);
          } else {
            quantityDelta = convertToGrams(purchaseQuantity, purchaseUnit, {
              weightPerBagInGrams: Number.isFinite(weightPerBagInGrams) ? weightPerBagInGrams : undefined
            });
          }
        } else {
          quantityDelta = toIntegerGrams(legacyQuantityDelta);
        }
      } catch (error) {
        return fail("invalid_quantity_delta", error instanceof Error ? error.message : "Invalid quantity conversion.", 422);
      }

      if (!Number.isFinite(quantityDelta) || quantityDelta <= 0) {
        return fail("invalid_quantity_delta", "quantity_delta must be greater than 0.", 422);
      }

      const prevQty = Number(ingredient.quantity_on_hand ?? 0);
      const prevAvgCost = Number(ingredient.avg_unit_cost ?? 0);
      const nextQty = toIntegerGrams(prevQty + quantityDelta);
      const receivedUnitCost = receivedTotalCost > 0 ? receivedTotalCost / quantityDelta : 0;
      const nextAvgCost =
        receivedTotalCost > 0 && nextQty > 0
          ? (Math.max(0, prevQty) * Math.max(0, prevAvgCost) + receivedTotalCost) / nextQty
          : Math.max(0, prevAvgCost);

      const { error: updateError } = await supabase
        .from("ingredients")
        .update({
          quantity_on_hand: nextQty,
          avg_unit_cost: round4(nextAvgCost),
          last_purchase_unit_cost: round4(receivedUnitCost)
        })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .eq("id", resolvedIngredientId);
      if (updateError && isMissingIngredientCostColumnsError(updateError)) {
        const legacyUpdate = await supabase
          .from("ingredients")
          .update({
            quantity_on_hand: nextQty
          })
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", scopedBranchId)
          .eq("id", resolvedIngredientId);
        if (legacyUpdate.error) {
          return fail("ingredient_restock_failed", legacyUpdate.error.message, 500);
        }
      } else if (updateError) {
        return fail("ingredient_restock_failed", updateError.message, 500);
      }

      const { data: movement, error: movementError } = await supabase
        .from("stock_movements")
        .insert({
          tenant_id: auth.tenantId!,
          branch_id: scopedBranchId,
          ingredient_id: resolvedIngredientId,
          movement_type: "purchase",
          quantity_delta: toIntegerGrams(quantityDelta),
          reason,
          ref_table: "ingredients",
          ref_id: resolvedIngredientId,
          created_by: auth.userId
        })
        .select("id,movement_type,quantity_delta,created_at")
        .single();

      if (movementError) {
        return fail("stock_movement_insert_failed", movementError.message, 500);
      }
      return ok(movement, 201);
    }

    if (body.action === "delete_ingredient") {
      const ingredientId = String(body.ingredient_id ?? "").trim();
      if (!ingredientId) {
        return fail("invalid_ingredient_id", "ingredient_id is required.", 422);
      }
      const outcome = await deleteOrArchiveIngredient(ingredientId);
      if (!outcome.ok) {
        return fail(outcome.code, outcome.message, outcome.status);
      }
      return ok({
        deleted: true,
        archived: outcome.archived,
        ingredient_id: ingredientId
      });
    }

    if (body.action === "bulk_delete_ingredients") {
      const ingredientIds = Array.from(
        new Set((Array.isArray(body.ingredient_ids) ? body.ingredient_ids : []).map((id) => String(id ?? "").trim()).filter(Boolean))
      );
      if (ingredientIds.length === 0) {
        return fail("invalid_ingredient_ids", "ingredient_ids must include at least one ingredient id.", 422);
      }

      let archivedCount = 0;
      for (const ingredientId of ingredientIds) {
        const outcome = await deleteOrArchiveIngredient(ingredientId);
        if (!outcome.ok) {
          return fail(outcome.code, outcome.message, outcome.status);
        }
        if (outcome.archived) {
          archivedCount += 1;
        }
      }

      return ok({
        deleted_count: ingredientIds.length,
        archived_count: archivedCount
      });
    }

    if (body.action === "upsert_recipe_line") {
      const productId = body.product_id?.trim();
      const ingredientId = body.ingredient_id?.trim();
      const qtyPerItem = Number(body.quantity_per_item);
      const qtyPerItemUnit = normalizeRecipeQuantityUnit((body as UpsertRecipeLinePayload).quantity_unit);
      const appliesTakeawayOnly = Boolean(body.applies_when_takeaway_only ?? false);

      if (!productId || !ingredientId) {
        return fail("invalid_recipe_line_ids", "product_id and ingredient_id are required.", 422);
      }
      if (!Number.isFinite(qtyPerItem) || qtyPerItem <= 0) {
        return fail("invalid_recipe_quantity", "quantity_per_item must be greater than 0.", 422);
      }

      const [{ data: product, error: productError }, { data: ingredient, error: ingredientError }] = await Promise.all([
        supabase
          .from("products")
          .select("id")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", scopedBranchId)
          .eq("id", productId)
          .maybeSingle(),
        supabase
          .from("ingredients")
          .select("id,base_unit")
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", scopedBranchId)
          .eq("id", ingredientId)
          .maybeSingle<{ id: string; base_unit: string }>()
      ]);
      if (productError) {
        return fail("product_query_failed", productError.message, 500);
      }
      if (ingredientError) {
        return fail("ingredient_query_failed", ingredientError.message, 500);
      }
      if (!product) {
        return fail("product_not_found", "Product not found in this branch.", 404);
      }
      if (!ingredient) {
        return fail("ingredient_not_found", "Ingredient not found in this branch.", 404);
      }

      let qtyPerItemInBaseUnit = 0;
      try {
        qtyPerItemInBaseUnit = toRecipeQuantityByIngredientBaseUnit({
          quantity: qtyPerItem,
          quantityUnit: qtyPerItemUnit,
          ingredientBaseUnit: ingredient.base_unit
        });
      } catch (error) {
        return fail("invalid_recipe_quantity_unit", error instanceof Error ? error.message : "Invalid recipe quantity unit.", 422);
      }

      const { data, error } = await supabase
        .from("recipes")
        .upsert(
          {
            tenant_id: auth.tenantId!,
            branch_id: scopedBranchId,
            product_id: productId,
            ingredient_id: ingredientId,
            quantity_per_item: qtyPerItemInBaseUnit,
            applies_when_takeaway_only: appliesTakeawayOnly
          },
          { onConflict: "product_id,ingredient_id,applies_when_takeaway_only" }
        )
        .select("id,product_id,ingredient_id,quantity_per_item,applies_when_takeaway_only,created_at")
        .single();
      if (error) {
        return fail("recipe_upsert_failed", error.message, 500);
      }

      await supabase
        .from("products")
        .update({ stock_deduction_mode: "recipe_deduction" })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .eq("id", productId);

      return ok(data);
    }

    if (body.action === "delete_recipe_line") {
      const productId = body.product_id?.trim();
      const ingredientId = body.ingredient_id?.trim();
      const appliesTakeawayOnly = Boolean(body.applies_when_takeaway_only ?? false);

      if (!productId || !ingredientId) {
        return fail("invalid_recipe_line_ids", "product_id and ingredient_id are required.", 422);
      }

      const { error } = await supabase
        .from("recipes")
        .delete()
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", scopedBranchId)
        .eq("product_id", productId)
        .eq("ingredient_id", ingredientId)
        .eq("applies_when_takeaway_only", appliesTakeawayOnly);
      if (error) {
        return fail("recipe_delete_failed", error.message, 500);
      }

      return ok({ deleted: true });
    }

    return fail("unsupported_action", "Unsupported action.", 422);
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    const message = error instanceof Error ? error.message : "Authentication failed.";
    if (message === "forbidden_branch_scope") {
      return fail("forbidden_branch_scope", "ไม่สามารถแก้ไขข้อมูลข้ามสาขาได้ กรุณารีเฟรชหน้าแล้วเลือกสาขาปัจจุบันอีกครั้ง", 403);
    }
    if (message.startsWith("branch_scope_query_failed:")) {
      return fail("branch_scope_query_failed", message.slice("branch_scope_query_failed:".length), 500);
    }
    return fail("unauthorized", message, 401);
  }
}




