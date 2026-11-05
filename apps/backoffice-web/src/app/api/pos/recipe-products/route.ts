import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { fail, ok } from "@/lib/http";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function isMissingRecipesSchemaError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  if (code === "42P01" || code === "PGRST205") return true;
  return text.includes("recipes");
}

function isMissingModifierSchemaError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return code === "42P01" || code === "PGRST205" || text.includes("product_modifier");
}

function normalizeProductId(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export async function GET(req: Request) {
  try {
    const auth = await getPosApiAuthContext({ requireBranchScope: true, requiredPermission: "sales:enter" });
    const supabase = getSupabaseServiceClient();
    const url = new URL(req.url);
    // Native cashier must never mistake missing modifier tables for zero required choices.
    const strictNative = url.searchParams.get("strict_native") === "1";
    const rawProductIds = String(url.searchParams.get("product_ids") ?? "");
    const productIds = Array.from(
      new Set(
        rawProductIds
          .split(",")
          .map((entry) => normalizeProductId(entry))
          .filter(Boolean)
      )
    ).slice(0, 250);

    if (productIds.length === 0) {
      return ok({ product_ids: [] as string[], ingredients_by_product: {} });
    }

    const { data, error } = await supabase
      .from("recipes")
      .select("product_id,ingredient_id,quantity_per_item,ingredients(name,base_unit,quantity_on_hand)")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .in("product_id", productIds);

    if (error) {
      if (isMissingRecipesSchemaError(error)) {
        if (strictNative) return fail("native_recipe_schema_unavailable", "Native catalog cannot verify recipes.", 503);
        return ok({ product_ids: [] as string[], ingredients_by_product: {} });
      }
      return fail("recipe_products_query_failed", error.message, 500);
    }

    const recipeProductIds = Array.from(
      new Set(
        (data ?? [])
          .map((row) => normalizeProductId(String(row.product_id ?? "")))
          .filter(Boolean)
      )
    );
    const ingredientsByProduct: Record<string, Array<{ ingredient_id: string; name: string; base_unit: string; quantity_per_item: number; quantity_on_hand: number }>> = {};
    for (const row of data ?? []) {
      const productId = normalizeProductId(String(row.product_id ?? ""));
      const ingredientId = normalizeProductId(String(row.ingredient_id ?? ""));
      if (!productId || !ingredientId) continue;
      const ingredient = Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients;
      const name = String(ingredient?.name ?? "").trim();
      if (!name || name.startsWith("STOCK:")) continue;
      ingredientsByProduct[productId] ??= [];
      ingredientsByProduct[productId].push({
        ingredient_id: ingredientId,
        name,
        base_unit: String(ingredient?.base_unit ?? ""),
        quantity_per_item: Number(row.quantity_per_item ?? 0),
        quantity_on_hand: Number(ingredient?.quantity_on_hand ?? 0)
      });
    }

    const { data: modifierGroupRows, error: modifierGroupError } = await supabase
      .from("product_modifier_groups")
      .select("id,product_id,name,selection_type,is_required,min_select,max_select,sort_order")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("is_active", true)
      .in("product_id", productIds)
      .order("sort_order", { ascending: true });

    const modifierGroupsByProduct: Record<
      string,
      Array<{
        id: string;
        name: string;
        selection_type: "single" | "multiple";
        is_required: boolean;
        min_select: number;
        max_select: number;
        options: Array<{ id: string; name: string; price_delta: number; is_default: boolean }>;
      }>
    > = {};

    if (!modifierGroupError) {
      const groupIds = (modifierGroupRows ?? []).map((row) => String(row.id));
      const { data: optionRows, error: optionError } = groupIds.length
        ? await supabase
            .from("product_modifier_options")
            .select("id,group_id,name,price_delta,is_default,sort_order")
            .eq("tenant_id", auth.tenantId!)
            .eq("branch_id", auth.branchId!)
            .eq("is_active", true)
            .in("group_id", groupIds)
            .order("sort_order", { ascending: true })
        : { data: [], error: null };
      if (optionError && strictNative) {
        return fail("native_modifier_options_unavailable", "Native modifier options are unavailable.", 503);
      }
      if (optionError && !isMissingModifierSchemaError(optionError)) {
        return fail("modifier_options_query_failed", optionError.message, 500);
      }
      const optionsByGroup = new Map<string, Array<{ id: string; name: string; price_delta: number; is_default: boolean }>>();
      for (const option of optionRows ?? []) {
        const groupId = String(option.group_id);
        const rows = optionsByGroup.get(groupId) ?? [];
        rows.push({
          id: String(option.id),
          name: String(option.name ?? ""),
          price_delta: Number(option.price_delta ?? 0),
          is_default: Boolean(option.is_default)
        });
        optionsByGroup.set(groupId, rows);
      }
      for (const group of modifierGroupRows ?? []) {
        const productId = String(group.product_id);
        modifierGroupsByProduct[productId] ??= [];
        modifierGroupsByProduct[productId].push({
          id: String(group.id),
          name: String(group.name ?? ""),
          selection_type: group.selection_type === "single" ? "single" : "multiple",
          is_required: Boolean(group.is_required),
          min_select: Number(group.min_select ?? 0),
          max_select: Number(group.max_select ?? 0),
          options: optionsByGroup.get(String(group.id)) ?? []
        });
      }
    } else if (strictNative) {
      return fail("native_modifier_schema_unavailable", "Native modifier schema is unavailable.", 503);
    } else if (!isMissingModifierSchemaError(modifierGroupError)) {
      return fail("modifier_groups_query_failed", modifierGroupError.message, 500);
    }

    return ok({
      product_ids: recipeProductIds,
      ingredients_by_product: ingredientsByProduct,
      modifier_groups_by_product: modifierGroupsByProduct
    });
  } catch (error) {
    return fail("pos_recipe_products_failed", error instanceof Error ? error.message : "Unknown error", 400);
  }
}
