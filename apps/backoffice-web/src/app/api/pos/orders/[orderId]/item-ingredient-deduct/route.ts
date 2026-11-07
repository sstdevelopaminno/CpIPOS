import type { OrderType } from "@pos/shared-types";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { appendAuditLog } from "@/lib/audit-log";
import { calculateRecipeUsage, toIntegerGrams, validateStockBeforeDeduction } from "@/lib/ingredient-stock";
import { validatePosItemIngredientAdjustment } from "@/lib/pos-item-ingredient-adjustment";
import { fail, ok } from "@/lib/http";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

function isMissingColumnError(message: string, column: string): boolean {
  const normalized = String(message ?? "").toLowerCase();
  const target = String(column ?? "").toLowerCase();
  if (!normalized.includes("does not exist")) return false;
  return (
    normalized.includes(`column "${target}"`) ||
    normalized.includes(`column '${target}'`) ||
    normalized.includes(`column ${target}`) ||
    normalized.includes(`products.${target}`)
  );
}

function shouldApplyTakeawayOnlyRecipe(orderType: OrderType): boolean {
  return orderType === "takeaway" || orderType === "delivery_manual";
}

function resolveAllowNegativeStockFallback(): boolean {
  const flag = process.env.POS_ALLOW_NEGATIVE_STOCK;
  if (flag === "1") return true;
  if (flag?.toLowerCase() === "true") return true;
  return false;
}

async function loadManualOutstandingByIngredient(args: {
  supabase: ReturnType<typeof getSupabaseServiceClient>;
  tenantId: string;
  branchId: string;
  orderId: string;
  productId: string;
  ingredientIds: string[];
}) {
  const { supabase, tenantId, branchId, orderId, productId, ingredientIds } = args;
  if (ingredientIds.length === 0) return new Map<string, number>();

  const { data: movementRows, error: movementError } = await supabase
    .from("stock_movements")
    .select("ingredient_id,quantity_delta")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("ref_table", "orders")
    .eq("ref_id", orderId)
    .eq("movement_type", "sale_deduction")
    .in("ingredient_id", ingredientIds)
    .ilike("reason", `%per-item recipe%(${productId})%`);

  if (movementError) {
    return null;
  }

  const sumByIngredient = new Map<string, number>();
  for (const row of movementRows ?? []) {
    const ingredientId = String(row.ingredient_id ?? "").trim();
    if (!ingredientId) continue;
    const delta = toIntegerGrams(Number(row.quantity_delta ?? 0));
    sumByIngredient.set(ingredientId, toIntegerGrams((sumByIngredient.get(ingredientId) ?? 0) + delta));
  }

  const outstandingByIngredient = new Map<string, number>();
  for (const ingredientId of ingredientIds) {
    const netDelta = toIntegerGrams(sumByIngredient.get(ingredientId) ?? 0);
    outstandingByIngredient.set(ingredientId, Math.max(0, toIntegerGrams(-netDelta)));
  }
  return outstandingByIngredient;
}

export async function GET(req: Request, context: { params: Promise<{ orderId: string }> }) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:enter" });
    const supabase = getSupabaseServiceClient();
    const { orderId } = await context.params;
    const url = new URL(req.url);
    const productId = String(url.searchParams.get("product_id") ?? "").trim();
    const quantity = Number(url.searchParams.get("quantity") ?? 1);

    if (!orderId) return fail("invalid_order_id", "orderId is required.", 422);
    if (!productId) return fail("invalid_product_id", "product_id is required.", 422);
    if (!Number.isFinite(quantity) || quantity <= 0) return fail("invalid_quantity", "quantity must be greater than 0.", 422);

    const { data: orderRow, error: orderError } = await supabase
      .from("orders")
      .select("id,order_type")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", orderId)
      .maybeSingle<{ id: string; order_type: OrderType }>();

    if (orderError) return fail("order_query_failed", orderError.message, 500);
    if (!orderRow) return fail("order_not_found", "Order not found in this branch.", 404);

    const { data: recipeRows, error: recipeError } = await supabase
      .from("recipes")
      .select("ingredient_id,quantity_per_item,applies_when_takeaway_only")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("product_id", productId);
    if (recipeError) return fail("recipe_query_failed", recipeError.message, 500);

    const usage = calculateRecipeUsage(
      (recipeRows ?? [])
        .filter((row) => {
          const takeawayOnly = Boolean(row.applies_when_takeaway_only);
          if (!takeawayOnly) return true;
          return shouldApplyTakeawayOnlyRecipe(orderRow.order_type);
        })
        .map((row) => ({
          productId,
          ingredientId: String(row.ingredient_id),
          usageInGrams: toIntegerGrams(Number(row.quantity_per_item ?? 0))
        }))
        .filter((entry) => entry.usageInGrams > 0),
      quantity
    );
    if (usage.length === 0) {
      return fail("recipe_not_found", "No active recipe lines found for this product.", 409);
    }

    const ingredientIds = usage.map((entry) => entry.ingredientId);
    const { data: ingredientRows, error: ingredientError } = await supabase
      .from("ingredients")
      .select("id,name,quantity_on_hand")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .in("id", ingredientIds);
    if (ingredientError) return fail("ingredient_query_failed", ingredientError.message, 500);

    const ingredientMetaMap = new Map(
      (ingredientRows ?? []).map((row) => [
        String(row.id),
        {
          name: String(row.name ?? ""),
          availableGrams: toIntegerGrams(Number(row.quantity_on_hand ?? 0))
        }
      ])
    );
    const outstandingByIngredient =
      (await loadManualOutstandingByIngredient({
        supabase,
        tenantId: auth.tenantId!,
        branchId: auth.branchId!,
        orderId,
        productId,
        ingredientIds
      })) ?? new Map<string, number>();

    return ok({
      order_id: orderId,
      product_id: productId,
      quantity,
      ingredients: usage.map((entry) => ({
        ingredient_id: entry.ingredientId,
        ingredient_name: ingredientMetaMap.get(entry.ingredientId)?.name ?? "",
        required_grams: entry.requiredGrams,
        available_grams: ingredientMetaMap.get(entry.ingredientId)?.availableGrams ?? 0,
        restorable_grams: Math.max(0, Number(outstandingByIngredient.get(entry.ingredientId) ?? 0))
      }))
    });
  } catch (error) {
    return fail("pos_item_ingredient_options_failed", error instanceof Error ? error.message : "Unknown error", 400);
  }
}

export async function POST(req: Request, context: { params: Promise<{ orderId: string }> }) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:enter" });
    const supabase = getSupabaseServiceClient();
    const { orderId } = await context.params;
    const parsed = validatePosItemIngredientAdjustment(await req.json().catch(() => null));
    if (!parsed.ok) {
      return fail(parsed.code, parsed.message, parsed.status);
    }
    const body = parsed.data;

    if (!orderId) {
      return fail("invalid_order_id", "orderId is required.", 422);
    }

    const productId = body.product_id;
    const quantity = body.quantity;
    const mode = body.mode;

    const { data: orderRow, error: orderError } = await supabase
      .from("orders")
      .select("id,order_no,order_type,status")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", orderId)
      .maybeSingle<{ id: string; order_no: string; order_type: OrderType; status: string }>();

    if (orderError) {
      return fail("order_query_failed", orderError.message, 500);
    }
    if (!orderRow) {
      return fail("order_not_found", "Order not found in this branch.", 404);
    }
    if (orderRow.status === "cancelled") {
      return fail("order_not_adjustable", "Cancelled order cannot adjust ingredient deduction.", 409);
    }

    const productWithMode = await supabase
      .from("products")
      .select("id,name,stock_deduction_mode")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", productId)
      .maybeSingle<{ id: string; name: string | null; stock_deduction_mode: "unit_only" | "recipe_deduction" | null }>();

    let productRow: { id: string; name: string | null; stock_deduction_mode?: "unit_only" | "recipe_deduction" | null } | null =
      productWithMode.data ?? null;
    if (productWithMode.error) {
      if (!isMissingColumnError(productWithMode.error.message, "stock_deduction_mode")) {
        return fail("product_query_failed", productWithMode.error.message, 500);
      }
      const productLegacy = await supabase
        .from("products")
        .select("id,name")
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("id", productId)
        .maybeSingle<{ id: string; name: string | null }>();
      if (productLegacy.error) {
        return fail("product_query_failed", productLegacy.error.message, 500);
      }
      productRow = productLegacy.data ? { ...productLegacy.data, stock_deduction_mode: null } : null;
    }

    if (!productRow) {
      return fail("product_not_found", "Product not found in this branch.", 404);
    }

    if (productRow.stock_deduction_mode && productRow.stock_deduction_mode !== "recipe_deduction") {
      return fail("product_not_recipe_mode", "This product is not in recipe deduction mode.", 409);
    }

    const { data: recipeRows, error: recipeError } = await supabase
      .from("recipes")
      .select("product_id,ingredient_id,quantity_per_item,applies_when_takeaway_only")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("product_id", productId);

    if (recipeError) {
      return fail("recipe_query_failed", recipeError.message, 500);
    }

    const recipeIngredients = (recipeRows ?? [])
      .filter((row) => {
        const takeawayOnly = Boolean(row.applies_when_takeaway_only);
        if (!takeawayOnly) return true;
        return shouldApplyTakeawayOnlyRecipe(orderRow.order_type);
      })
      .map((row) => ({
        productId,
        ingredientId: String(row.ingredient_id),
        usageInGrams: toIntegerGrams(Number(row.quantity_per_item ?? 0))
      }))
      .filter((line) => line.usageInGrams > 0);

    if (recipeIngredients.length === 0) {
      return fail("recipe_not_found", "No active recipe lines found for this product.", 409);
    }

    const selectedIngredientIds = body.ingredient_ids;
    const rawUsage = calculateRecipeUsage(recipeIngredients, quantity);
    const recipeIngredientIds = new Set(rawUsage.map((entry) => entry.ingredientId));
    if (selectedIngredientIds.some((id) => !recipeIngredientIds.has(id))) {
      return fail("invalid_ingredient_selection", "Selected ingredient is not part of this product recipe.", 422);
    }
    const usage = rawUsage.filter((entry) => selectedIngredientIds.includes(entry.ingredientId));
    if (usage.length === 0) {
      return fail("ingredient_selection_required", "Select at least one ingredient for this adjustment.", 422);
    }
    const ingredientIds = usage.map((entry) => entry.ingredientId);
    const { data: ingredientRows, error: ingredientError } = await supabase
      .from("ingredients")
      .select("id,name,quantity_on_hand")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .in("id", ingredientIds);

    if (ingredientError) {
      return fail("ingredient_query_failed", ingredientError.message, 500);
    }

    let allowNegativeStock = resolveAllowNegativeStockFallback();
    const inventorySettingsQuery = await supabase
      .from("branch_inventory_settings")
      .select("allow_negative_stock")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .maybeSingle<{ allow_negative_stock: boolean }>();

    if (inventorySettingsQuery.error) {
      const normalized = inventorySettingsQuery.error.message.toLowerCase();
      const isMissingSettings = normalized.includes("could not find the table") || normalized.includes("branch_inventory_settings");
      if (!isMissingSettings) {
        return fail("inventory_settings_query_failed", inventorySettingsQuery.error.message, 500);
      }
    } else if (inventorySettingsQuery.data) {
      allowNegativeStock = Boolean(inventorySettingsQuery.data.allow_negative_stock);
    }

    const ingredientMap = new Map(
      (ingredientRows ?? []).map((row) => [
        String(row.id),
        {
          id: String(row.id),
          name: String(row.name ?? ""),
          stockInGrams: toIntegerGrams(Number(row.quantity_on_hand ?? 0))
        }
      ])
    );

    const manualOutstandingByIngredient =
      mode === "restore"
        ? await loadManualOutstandingByIngredient({
            supabase,
            tenantId: auth.tenantId!,
            branchId: auth.branchId!,
            orderId,
            productId,
            ingredientIds
          })
        : null;

    for (const entry of usage) {
      const ingredient = ingredientMap.get(entry.ingredientId);
      if (!ingredient) {
        return fail("ingredient_not_found", `INGREDIENT_NOT_FOUND:${entry.ingredientId}`, 409);
      }
      if (mode === "deduct") {
        const check = validateStockBeforeDeduction(ingredient, entry.requiredGrams, { allowNegativeStock });
        if (!check.ok) {
          return fail("insufficient_stock", `INSUFFICIENT_STOCK:${entry.ingredientId}`, 409);
        }
      } else {
        const restorable = Math.max(0, Number(manualOutstandingByIngredient?.get(entry.ingredientId) ?? 0));
        if (restorable < entry.requiredGrams) {
          return fail("restore_exceeds_deducted", `RESTORE_EXCEEDS_DEDUCTED:${entry.ingredientId}`, 409);
        }
      }
    }

    for (const entry of usage) {
      const ingredient = ingredientMap.get(entry.ingredientId);
      if (!ingredient) continue;
      const nextStock = mode === "restore"
        ? toIntegerGrams(ingredient.stockInGrams + entry.requiredGrams)
        : toIntegerGrams(ingredient.stockInGrams - entry.requiredGrams);
      const updateQuery = supabase
        .from("ingredients")
        .update({ quantity_on_hand: nextStock })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("id", entry.ingredientId);
      const { error: updateError } = allowNegativeStock
        ? await updateQuery
        : mode === "deduct"
          ? await updateQuery.gte("quantity_on_hand", entry.requiredGrams)
          : await updateQuery;
      if (updateError) {
        return fail("ingredient_update_failed", updateError.message, 500);
      }
      ingredient.stockInGrams = nextStock;
    }

    const requestKey = req.headers.get("x-idempotency-key")?.trim() || "";
    const movementReasonBase =
      body.note?.trim() ||
      (mode === "restore"
        ? `Manual per-item recipe restore from POS bill ${orderRow.order_no}`
        : `Manual per-item recipe deduction from POS bill ${orderRow.order_no}`);
    const movementRows = usage.map((entry) => ({
      tenant_id: auth.tenantId!,
      branch_id: auth.branchId!,
      ingredient_id: entry.ingredientId,
      movement_type: "sale_deduction" as const,
      quantity_delta: mode === "restore" ? Math.abs(entry.requiredGrams) : -Math.abs(entry.requiredGrams),
      reason: `${movementReasonBase} (${productId})`,
      ref_table: "orders",
      ref_id: orderId,
      created_by: auth.userId,
      request_id: requestKey ? `${requestKey}:${entry.ingredientId}` : null
    }));

    const { error: movementError } = await supabase.from("stock_movements").insert(movementRows);
    if (movementError) {
      return fail("stock_movement_insert_failed", movementError.message, 500);
    }

    void appendAuditLog({
      tenantId: auth.tenantId!,
      branchId: auth.branchId!,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? auth.platformRole,
      action: "pos_item_recipe_deduction_applied",
      targetTable: "orders",
      targetId: orderId,
      metadata: {
        order_no: orderRow.order_no,
        order_status: orderRow.status,
        product_id: productId,
        mode,
        quantity,
        ingredients_count: usage.length
      }
    });

    return ok({
      order_id: orderId,
      order_no: orderRow.order_no,
      product_id: productId,
      mode,
      quantity,
      deductions: usage.map((entry) => ({
        ingredient_id: entry.ingredientId,
        required_grams: entry.requiredGrams
      }))
    });
  } catch (error) {
    return fail("pos_item_ingredient_deduct_failed", error instanceof Error ? error.message : "Unknown error", 400);
  }
}
