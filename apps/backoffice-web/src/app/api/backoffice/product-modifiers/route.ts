import { getAuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const validId = (id: unknown): id is string => typeof id === "string" && UUID.test(id);
const manager = (role: string | null) => role === "owner" || role === "manager";
const label = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 120) : "";
const amount = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
const failRequest = (e: unknown) => {
  const feature = featureGateFail(e);
  if (feature) return feature;
  return fail("unauthorized", e instanceof Error ? e.message : "Authentication required.", 401);
};

export async function GET(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    await requirePosApiFeature(auth, "stock_management");
    const productId = new URL(req.url).searchParams.get("product_id");
    if (!validId(productId)) return fail("invalid_product_id", "Select a product.", 422);
    const db = getSupabaseServiceClient();
    const product = await db.from("products").select("id,name")
      .eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!)
      .eq("id", productId).maybeSingle();
    if (product.error) return fail("product_query_failed", "Product lookup failed.", 500);
    if (!product.data) return fail("product_not_in_branch", "Product not available in this branch.", 404);
    const groupsQuery = await db.from("product_modifier_groups")
      .select("id,name,selection_type,is_required,min_select,max_select,sort_order,is_active")
      .eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!)
      .eq("product_id", productId).order("sort_order", { ascending: true });
    if (groupsQuery.error) return fail("modifier_schema_unavailable", "Unable to load product groups.", 503);
    const groups = groupsQuery.data ?? [];
    const groupIds = groups.map((g) => g.id);
    const optionsQuery = groupIds.length
      ? await db.from("product_modifier_options")
          .select("id,group_id,name,price_delta,is_default,sort_order,is_active")
          .eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!)
          .in("group_id", groupIds).order("sort_order", { ascending: true })
      : { data: [], error: null };
    if (optionsQuery.error) return fail("modifier_options_unavailable", "Unable to load product options.", 503);
    const options = optionsQuery.data ?? [];
    const optionIds = options.map((o) => o.id);
    const [deltaQuery, ingredientsQuery] = await Promise.all([
      optionIds.length
        ? db.from("product_modifier_option_ingredients")
            .select("option_id,ingredient_id,quantity_delta_per_item")
            .eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!)
            .in("option_id", optionIds)
        : Promise.resolve({ data: [], error: null }),
      db.from("ingredients").select("id,name,base_unit,quantity_on_hand")
        .eq("tenant_id", auth.tenantId!).eq("branch_id", auth.branchId!)
        .order("name", { ascending: true }).limit(500)
    ]);
    if (deltaQuery.error || ingredientsQuery.error) {
      return fail("modifier_ingredient_query_failed", "Unable to load ingredient details.", 503);
    }
    return ok({
      product: product.data,
      groups: groups.map((g) => ({
        ...g, options: options.filter((o) => o.group_id === g.id).map((o) => ({
          ...o, ingredients: (deltaQuery.data ?? []).filter((d) => d.option_id === o.id)
        }))
      })),
      ingredients: (ingredientsQuery.data ?? []).filter((i) =>
        !String(i.name ?? "").startsWith("STOCK:") &&
        !String(i.name ?? "").startsWith("__archived__:")
      )
    });
  } catch (e) {
    return failRequest(e);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    await requirePosApiFeature(auth, "stock_management");
    if (!manager(auth.branchRole)) return fail("manager_required", "Owner or manager permission is required.", 403);
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return fail("invalid_payload", "Expected JSON.", 422);
    const db = getSupabaseServiceClient();
    const scope = { tenant_id: auth.tenantId!, branch_id: auth.branchId! };
    const action = body.action;
    const groupRow = async (id: unknown) => {
      if (!validId(id)) return null;
      const found = await db.from("product_modifier_groups").select("id,product_id,is_active")
        .eq("tenant_id", scope.tenant_id).eq("branch_id", scope.branch_id)
        .eq("id", id).maybeSingle();
      return found.error ? null : found.data;
    };
    const optionRow = async (id: unknown) => {
      if (!validId(id)) return null;
      const found = await db.from("product_modifier_options").select("id,group_id,is_active")
        .eq("tenant_id", scope.tenant_id).eq("branch_id", scope.branch_id)
        .eq("id", id).maybeSingle();
      return found.error ? null : found.data;
    };

    if (action === "save_group") {
      if (!validId(body.product_id)) return fail("invalid_product", "Select a product.", 422);
      const product = await db.from("products").select("id")
        .eq("tenant_id", scope.tenant_id).eq("branch_id", scope.branch_id)
        .eq("id", body.product_id).maybeSingle();
      if (product.error || !product.data) return fail("product_not_in_branch", "Product not found.", 404);
      const name = label(body.name);
      const selection = body.selection_type;
      const required = body.is_required === true;
      const min = Number(body.min_select);
      const max = Number(body.max_select);
      if (!name || !["single","multiple"].includes(String(selection)) ||
          !Number.isSafeInteger(min) || !Number.isSafeInteger(max) ||
          min < 0 || max < 1 || max > 24 || min > max ||
          (selection === "single" && max !== 1) || (required && min < 1)) {
        return fail("invalid_modifier_group", "Check required choices and minimum/maximum.", 422);
      }
      const values = {
        name, selection_type: selection, is_required: required, min_select: min, max_select: max,
        sort_order: Number.isSafeInteger(body.sort_order) ? body.sort_order : 0,
        updated_at: new Date().toISOString()
      };
      if (body.id) {
        const old = await groupRow(body.id);
        if (!old || old.product_id !== body.product_id) return fail("group_not_in_branch", "Group unavailable.", 404);
        const result = await db.from("product_modifier_groups").update(values)
          .eq("tenant_id", scope.tenant_id).eq("branch_id", scope.branch_id)
          .eq("id", body.id).select("id").single();
        if (result.error) return fail("group_save_failed", "Unable to save group.", 500);
        return ok({ id: result.data.id });
      }
      const result = await db.from("product_modifier_groups")
        .insert({ ...scope, product_id: body.product_id, ...values }).select("id").single();
      if (result.error) return fail("group_create_failed", "Unable to create group.", 500);
      return ok({ id: result.data.id });
    }

    if (action === "save_option") {
      const group = await groupRow(body.group_id);
      if (!group || !group.is_active) return fail("group_not_active", "Group unavailable.", 404);
      const name = label(body.name);
      const price = amount(body.price_delta);
      if (!name || !Number.isFinite(price) || Math.abs(price) > 999999 ||
          Math.round(price * 100) !== price * 100) {
        return fail("invalid_modifier_option", "Check option name and price.", 422);
      }
      const values = {
        name, price_delta: Number(price.toFixed(2)),
        is_default: body.is_default === true,
        sort_order: Number.isSafeInteger(body.sort_order) ? body.sort_order : 0,
        updated_at: new Date().toISOString()
      };
      if (body.id) {
        const old = await optionRow(body.id);
        if (!old || old.group_id !== body.group_id) return fail("option_not_in_group", "Option unavailable.", 404);
        const result = await db.from("product_modifier_options").update(values)
          .eq("tenant_id", scope.tenant_id).eq("branch_id", scope.branch_id)
          .eq("id", body.id).select("id").single();
        if (result.error) return fail("option_save_failed", "Unable to save option.", 500);
        return ok({ id: result.data.id });
      }
      const result = await db.from("product_modifier_options")
        .insert({ ...scope, group_id: group.id, ...values }).select("id").single();
      if (result.error) return fail("option_create_failed", "Unable to create option.", 500);
      return ok({ id: result.data.id });
    }

    if (action === "save_ingredient_delta") {
      const opt = await optionRow(body.option_id);
      if (!opt || !opt.is_active || !validId(body.ingredient_id)) {
        return fail("invalid_option_ingredient", "Select an active option and ingredient.", 422);
      }
      const ingredient = await db.from("ingredients").select("id")
        .eq("tenant_id", scope.tenant_id).eq("branch_id", scope.branch_id)
        .eq("id", body.ingredient_id).maybeSingle();
      if (ingredient.error || !ingredient.data) return fail("ingredient_not_in_branch", "Ingredient unavailable.", 404);
      const delta = amount(body.quantity_delta_per_item);
      if (!Number.isFinite(delta) || Math.abs(delta) > 1000000 ||
        Math.round(delta * 1000) !== delta * 1000) {
        return fail("invalid_ingredient_delta", "Use a quantity with up to three decimal places.", 422);
      }
      if (delta === 0) {
        const removed = await db.from("product_modifier_option_ingredients").delete()
          .eq("tenant_id", scope.tenant_id).eq("branch_id", scope.branch_id)
          .eq("option_id", opt.id).eq("ingredient_id", body.ingredient_id);
        if (removed.error) return fail("ingredient_delta_remove_failed", "Unable to remove ingredient adjustment.", 500);
        return ok({ removed: true });
      }
      const saved = await db.from("product_modifier_option_ingredients").upsert({
        ...scope, option_id: opt.id, ingredient_id: body.ingredient_id, quantity_delta_per_item: delta
      }, { onConflict: "option_id,ingredient_id" }).select("id").single();
      if (saved.error) return fail("ingredient_delta_save_failed", "Unable to save ingredient adjustment.", 500);
      return ok({ id: saved.data.id });
    }

    if (action === "deactivate_group" || action === "deactivate_option") {
      const isGroup = action === "deactivate_group";
      const found = isGroup ? await groupRow(body.id) : await optionRow(body.id);
      if (!found) return fail("modifier_not_in_branch", "Option or group unavailable.", 404);
      const table = isGroup ? "product_modifier_groups" : "product_modifier_options";
      const updated = await db.from(table).update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("tenant_id", scope.tenant_id).eq("branch_id", scope.branch_id).eq("id", body.id);
      if (updated.error) return fail("modifier_deactivation_failed", "Unable to deactivate.", 500);
      return ok({ deactivated: true });
    }
    return fail("unsupported_action", "Unknown modifier action.", 422);
  } catch (e) {
    return failRequest(e);
  }
}
