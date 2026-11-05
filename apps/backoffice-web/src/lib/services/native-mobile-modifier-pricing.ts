import "server-only";

import { getProductSpecialPrice } from "@/lib/pos/product-metadata";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type NativeSelectionInput = {
  cart_line_id: string;
  price_kind: "regular" | "special";
  modifier_option_ids: string[];
  note?: string | null;
};

export type NativeOrderLineInput = {
  product_id: string;
  quantity: number;
  unit_price?: number | null;
  notes?: string | null;
  native_selection?: NativeSelectionInput;
};

type Product = { id: string; price: number; is_active: boolean; metadata: unknown };
type Group = {
  id: string; product_id: string; name: string; selection_type: "single" | "multiple";
  is_required: boolean; min_select: number; max_select: number;
};
type Option = { id: string; group_id: string; name: string; price_delta: number };

export type NativeSaleCheck =
  | { ok: true; items: Array<{ product_id: string; quantity: number; unit_price: number; notes: string | null; native_selection: NativeSelectionInput }> }
  | { ok: false; code: string; status: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const money = (value: number) => Math.round(value * 100) / 100;

function invalid(code: string, status = 422): NativeSaleCheck {
  return { ok: false, code, status };
}

/** Pure, testable server authority for one mobile sale line. */
export function validateNativeSaleLine(
  item: NativeOrderLineInput,
  product: Product,
  groups: Group[],
  options: Option[]
): NativeSaleCheck {
  const choice = item.native_selection;
  if (!choice || !UUID.test(item.product_id) || !product.is_active ||
      !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 999 ||
      (choice.price_kind !== "regular" && choice.price_kind !== "special") ||
      typeof choice.cart_line_id !== "string" ||
      choice.cart_line_id.length > 150 || choice.cart_line_id.length < 3 ||
      !Array.isArray(choice.modifier_option_ids) ||
      choice.modifier_option_ids.length > 24 ||
      choice.modifier_option_ids.some((id) => typeof id !== "string" || !UUID.test(id)) ||
      new Set(choice.modifier_option_ids).size !== choice.modifier_option_ids.length ||
      typeof choice.note === "string" && choice.note.length > 160
  ) return invalid("invalid_native_sale_selection");

  const special = getProductSpecialPrice(product.metadata);
  if (choice.price_kind === "special" && special === null) return invalid("special_price_not_configured", 409);
  const base = choice.price_kind === "special" ? special! : product.price;
  const active = new Set(choice.modifier_option_ids);
  const optionById = new Map(options.map((opt) => [opt.id, opt]));
  if (active.size > 0 && [...active].some((id) => !optionById.has(id))) {
    return invalid("invalid_modifier_option", 409);
  }

  for (const group of groups) {
    const selectedCount = options.filter((opt) => opt.group_id === group.id && active.has(opt.id)).length;
    const min = group.is_required ? Math.max(1, group.min_select) : group.min_select;
    if ((selectedCount === 0 && group.is_required) ||
        (selectedCount !== 0 && selectedCount < min) ||
        selectedCount > group.max_select ||
        (group.selection_type === "single" && selectedCount > 1)) {
      return invalid("required_modifier_selection_missing", 422);
    }
  }

  const optionNames = options.filter((opt) => active.has(opt.id)).map((opt) => opt.name);
  const selectedDelta = options.reduce((sum, opt) =>
    sum + (active.has(opt.id) ? Number(opt.price_delta) : 0), 0);
  const unitPrice = money(base + selectedDelta);
  if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 99999999) {
    return invalid("invalid_native_line_price", 422);
  }
  if (item.unit_price !== undefined && item.unit_price !== null &&
      (!Number.isFinite(item.unit_price) || Math.abs(money(item.unit_price) - unitPrice) >= 0.01)) {
    return invalid("native_price_changed_refresh_required", 409);
  }
  // The existing dine-in edit RPC groups items by product and notes. A
  // special-priced line must remain distinct from the regular-price line.
  const note = [
    choice.price_kind === "special" ? "ราคาพิเศษ" : "",
    optionNames.join(", "), String(choice.note ?? "").trim()
  ].filter(Boolean).join(" | ").slice(0, 240) || null;
  return {
    ok: true,
    items: [{ product_id: item.product_id, quantity: item.quantity, unit_price: unitPrice, notes: note,
      native_selection: choice }]
  };
}

/**
 * The existing Web POS /api/pos/sales contract is not modified for tablet
 * channels. Native-specific selections are recomputed under tenant/branch
 * scope before entering the existing order transaction.
 *
 * Modifier ingredient deltas are applied atomically in the updated DB order RPC;
 * selected ingredients must belong to the same tenant and branch.
 */
export async function resolveNativeMobileSaleLines(args: {
  tenantId: string;
  branchId: string;
  items: NativeOrderLineInput[];
}): Promise<NativeSaleCheck> {
  const { tenantId, branchId, items } = args;
  // Require explicit Production acceptance AND applied atomic SQL migrations.
  // Older Native builds keep using existing non-configured POS endpoints.
  if (process.env.NATIVE_ATOMIC_MENU_SALES_ENABLED !== "true") {
    return invalid("native_atomic_menu_release_gate_not_enabled", 503);
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    return invalid("invalid_native_cart");
  }
  if (items.some((item) => !item.native_selection)) {
    return invalid("native_selection_required");
  }
  const lineIds = items.map((item) => item.native_selection!.cart_line_id);
  if (new Set(lineIds).size !== lineIds.length) return invalid("duplicate_native_cart_line");
  const productIds = [...new Set(items.map((item) => item.product_id))];
  if (productIds.some((id) => !UUID.test(id))) return invalid("invalid_native_product");

  const db = getSupabaseServiceClient();
  const productsResult = await db.from("products")
    .select("id,price,is_active,metadata")
    .eq("tenant_id", tenantId).eq("branch_id", branchId)
    .in("id", productIds);
  if (productsResult.error) return invalid("native_products_query_failed", 503);
  const productMap = new Map((productsResult.data ?? []).map((product) => [
    String(product.id), product as Product
  ]));
  if (productMap.size !== productIds.length) return invalid("native_product_not_found", 422);

  const groupsResult = await db.from("product_modifier_groups")
    .select("id,product_id,name,selection_type,is_required,min_select,max_select")
    .eq("tenant_id", tenantId).eq("branch_id", branchId)
    .eq("is_active", true).in("product_id", productIds);
  if (groupsResult.error) return invalid("native_modifier_schema_unavailable", 503);
  const groups = (groupsResult.data ?? []) as Group[];
  const groupIds = groups.map((group) => group.id);

  const optionsResult = groupIds.length
    ? await db.from("product_modifier_options")
        .select("id,group_id,name,price_delta")
        .eq("tenant_id", tenantId).eq("branch_id", branchId)
        .eq("is_active", true).in("group_id", groupIds)
    : { data: [] as Option[], error: null };
  if (optionsResult.error) return invalid("native_modifier_options_unavailable", 503);
  const options = (optionsResult.data ?? []) as Option[];
  const selectedOptionIds = [...new Set(items.flatMap((item) =>
    item.native_selection?.modifier_option_ids ?? []))];
  if (selectedOptionIds.length > 0) {
    const ingredientsResult = await db.from("product_modifier_option_ingredients")
      .select("option_id,ingredient_id,quantity_delta_per_item")
      .eq("tenant_id", tenantId).eq("branch_id", branchId)
      .in("option_id", selectedOptionIds);
    if (ingredientsResult.error) return invalid("native_modifier_stock_schema_unavailable", 503);
    const modifiedIngredientIds = [...new Set((ingredientsResult.data ?? [])
      .filter((row) => Number(row.quantity_delta_per_item) !== 0)
      .map((row) => String(row.ingredient_id)))];
    if (modifiedIngredientIds.length) {
      const scoped = await db.from("ingredients").select("id")
        .eq("tenant_id", tenantId).eq("branch_id", branchId)
        .in("id", modifiedIngredientIds);
      if (scoped.error || (scoped.data ?? []).length !== modifiedIngredientIds.length) {
        return invalid("native_modifier_ingredient_not_in_branch", 409);
      }
    }
  }

  const output: Array<{ product_id: string; quantity: number; unit_price: number; notes: string | null; native_selection: NativeSelectionInput }> = [];
  for (const item of items) {
    const scopedGroups = groups.filter((group) => group.product_id === item.product_id);
    const scopedGroupIds = new Set(scopedGroups.map((group) => group.id));
    const scopedOptions = options.filter((opt) => scopedGroupIds.has(opt.group_id));
    const checked = validateNativeSaleLine(item, productMap.get(item.product_id)!, scopedGroups, scopedOptions);
    if (!checked.ok) return checked;
    output.push(...checked.items);
  }
  // The atomic dine-in RPC identifies each Native line by immutable cart_line_id.
  // Identical print notes never justify merging two independently selected lines.
  // Duplicate cart_line_id values were rejected above before canonical pricing.
  return { ok: true, items: output };
}
