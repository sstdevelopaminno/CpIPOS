import type { OrderType } from "@pos/shared-types";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { appendAuditLog } from "@/lib/audit-log";
import { calculateRecipeUsage, toIntegerGrams } from "@/lib/ingredient-stock";
import { validatePosItemIngredientAdjustment } from "@/lib/pos-item-ingredient-adjustment";
import { fail, ok } from "@/lib/http";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

function shouldApplyTakeawayOnlyRecipe(orderType: OrderType): boolean {
  return orderType === "takeaway" || orderType === "delivery_manual";
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
    .ilike("reason", `%(${productId})`);

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
    if (!orderId) {
      return fail("invalid_order_id", "orderId is required.", 422);
    }

    const requestKey = req.headers.get("x-idempotency-key")?.trim() ?? "";
    if (requestKey.length < 8 || requestKey.length > 180) {
      return fail("idempotency_key_required", "A valid x-idempotency-key is required for stock adjustment.", 422);
    }

    const body = parsed.data;
    const { data, error } = await supabase.rpc("adjust_pos_item_recipe_stock_tx", {
      p_tenant_id: auth.tenantId!,
      p_branch_id: auth.branchId!,
      p_order_id: orderId,
      p_product_id: body.product_id,
      p_quantity: body.quantity,
      p_mode: body.mode,
      p_ingredient_ids: body.ingredient_ids,
      p_actor_user_id: auth.userId,
      p_request_id: requestKey,
      p_note: body.note
    });

    if (error) {
      const message = error.message ?? "";
      if (message.includes("ORDER_NOT_FOUND")) {
        return fail("order_not_found", "Order not found in this branch.", 404);
      }
      if (message.includes("ORDER_NOT_ADJUSTABLE")) {
        return fail("order_not_adjustable", "Cancelled order cannot adjust ingredient deduction.", 409);
      }
      if (message.includes("PRODUCT_NOT_FOUND")) {
        return fail("product_not_found", "Product not found in this branch.", 404);
      }
      if (message.includes("PRODUCT_NOT_RECIPE_MODE")) {
        return fail("product_not_recipe_mode", "This product is not in recipe deduction mode.", 409);
      }
      if (message.includes("RECIPE_NOT_FOUND")) {
        return fail("recipe_not_found", "No active recipe lines found for this product.", 409);
      }
      if (message.includes("INVALID_INGREDIENT_SELECTION")) {
        return fail("invalid_ingredient_selection", "Selected ingredient is not part of this product recipe.", 422);
      }
      if (message.includes("INGREDIENT_NOT_FOUND")) {
        return fail("ingredient_not_found", message, 409);
      }
      if (message.includes("INSUFFICIENT_STOCK")) {
        return fail("insufficient_stock", message, 409);
      }
      if (message.includes("RESTORE_EXCEEDS_DEDUCTED")) {
        return fail("restore_exceeds_deducted", message, 409);
      }
      if (message.includes("IDEMPOTENCY_KEY_REUSED")) {
        return fail("idempotency_key_reused", "This idempotency key was already used with a different stock-adjustment payload.", 409);
      }
      if (message.includes("IDEMPOTENCY_RESULT_INCOMPLETE")) {
        return fail("idempotency_state_invalid", "The previous stock adjustment is incomplete and requires review.", 409);
      }
      if (message.includes("INVALID_REQUEST_KEY")) {
        return fail("idempotency_key_required", "A valid x-idempotency-key is required for stock adjustment.", 422);
      }
      return fail("ingredient_adjustment_failed", "Unable to safely apply the ingredient stock adjustment.", 503);
    }

    const rows = (Array.isArray(data) ? data : []) as Array<{
      ingredient_id: string;
      required_grams: number | string;
      quantity_delta: number | string;
      duplicate_request: boolean;
    }>;

    if (rows.length === 0) {
      return fail("ingredient_adjustment_failed", "Stock adjustment transaction returned no ingredient rows.", 503);
    }

    const duplicateRequest = rows.every((row) => row.duplicate_request === true);

    void appendAuditLog({
      tenantId: auth.tenantId!,
      branchId: auth.branchId!,
      actorUserId: auth.userId,
      actorRole: auth.branchRole ?? auth.platformRole,
      action: duplicateRequest ? "pos_item_recipe_adjustment_replayed" : "pos_item_recipe_deduction_applied",
      targetTable: "orders",
      targetId: orderId,
      metadata: {
        product_id: body.product_id,
        mode: body.mode,
        quantity: body.quantity,
        ingredients_count: rows.length,
        request_id: requestKey,
        duplicate_request: duplicateRequest
      }
    });

    return ok({
      order_id: orderId,
      product_id: body.product_id,
      mode: body.mode,
      quantity: body.quantity,
      duplicate_request: duplicateRequest,
      deductions: rows.map((row) => ({
        ingredient_id: String(row.ingredient_id),
        required_grams: Number(row.required_grams ?? 0),
        quantity_delta: Number(row.quantity_delta ?? 0)
      }))
    });
  } catch (error) {
    return fail("pos_item_ingredient_deduct_failed", error instanceof Error ? error.message : "Unknown error", 400);
  }
}
