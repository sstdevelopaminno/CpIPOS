import { NextResponse } from "next/server";
import { appendAuditLog } from "@/lib/audit-log";
import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { convertToGrams, toIntegerGrams } from "@/lib/ingredient-stock";
import { isProductRecommended, withProductRecommendedMetadata } from "@/lib/pos/product-metadata";
import {
  PosGuardError,
  requirePermission,
  requirePosSession,
  withPosSessionCookie
} from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

const ARCHIVED_INGREDIENT_PREFIX = "__archived__:";
const FALLBACK_INGREDIENT_PREFIX = "STOCK:";
const DELIVERY_CHANNELS = ["line_man", "grab", "shopee"] as const;

type BranchOption = {
  id: string;
  name: string;
  code: string | null;
  role: string;
};

const canManage = (role: string | null | undefined) => role === "owner" || role === "manager";
const safeText = (value: unknown, max = 120) => String(value ?? "").trim().slice(0, max);
const fail = (code: string, status = 422) =>
  NextResponse.json({ data: null, error: { code, message: code } }, { status });
const ok = (data: unknown, sessionId: string, status = 200) =>
  withPosSessionCookie(NextResponse.json({ data, error: null }, { status }), sessionId);
const round3 = (value: number) => Number(value.toFixed(3));
const round4 = (value: number) => Number(value.toFixed(4));

function normalizeSku(value: unknown) {
  const digits = String(value ?? "").replace(/\D+/g, "");
  if (digits) return digits.slice(0, 40);
  return (Date.now().toString() + Math.floor(Math.random() * 1000000).toString().padStart(6, "0")).slice(0, 40);
}

function normalizeRecipeUnit(value: unknown): "gram" | "khid" | "kg" | "piece" {
  const unit = String(value ?? "").trim().toLowerCase();
  if (unit === "khid") return "khid";
  if (unit === "kg") return "kg";
  if (unit === "piece" || unit === "unit" || unit === "ลูก") return "piece";
  return "gram";
}

function isPieceBaseUnit(value: unknown) {
  const unit = String(value ?? "").trim().toLowerCase();
  return unit === "piece" || unit === "unit" || unit === "ลูก";
}

function recipeQuantityForBaseUnit(input: {
  quantity: number;
  quantityUnit: "gram" | "khid" | "kg" | "piece";
  baseUnit: string;
}) {
  if (isPieceBaseUnit(input.baseUnit)) {
    if (input.quantityUnit !== "piece") throw new Error("invalid_recipe_unit_for_piece_ingredient");
    return toIntegerGrams(input.quantity);
  }
  if (input.quantityUnit === "piece") throw new Error("piece_unit_requires_piece_base_unit");
  return toIntegerGrams(convertToGrams(input.quantity, input.quantityUnit));
}

function handleError(error: unknown) {
  if (error instanceof PosGuardError || error instanceof FeatureGateError) {
    return fail(error.code, error.status);
  }
  const message = error instanceof Error ? error.message : "unknown";
  if (message === "forbidden_branch_scope") return fail(message, 403);
  console.error("[native-catalog]", message);
  return fail("catalog_request_failed", 500);
}

async function accessibleBranches(scope: Awaited<ReturnType<typeof requirePosSession>>): Promise<BranchOption[]> {
  const db = getSupabaseServiceClient();
  const current: BranchOption = {
    id: scope.session.branch_id,
    name: scope.branch?.name ?? scope.session.branch_id,
    code: scope.branch?.code ?? null,
    role: scope.session.role
  };
  if (!canManage(scope.session.role)) return [current];

  const roleRows = await db
    .from("user_branch_roles")
    .select("branch_id,role")
    .eq("tenant_id", scope.session.tenant_id)
    .eq("user_id", scope.session.user_id)
    .in("role", ["owner", "manager"]);
  if (roleRows.error) throw new Error("branch_role_query_failed");

  const roleMap = new Map<string, string>();
  for (const row of roleRows.data ?? []) roleMap.set(String(row.branch_id), String(row.role ?? ""));
  roleMap.set(current.id, current.role);
  const ids = Array.from(roleMap.keys());
  if (!ids.length) return [current];

  const branches = await db
    .from("branches")
    .select("id,name,code,is_active")
    .eq("tenant_id", scope.session.tenant_id)
    .eq("is_active", true)
    .in("id", ids)
    .order("created_at", { ascending: true });
  if (branches.error) throw new Error("branch_query_failed");

  const result = (branches.data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? row.id),
    code: row.code ? String(row.code) : null,
    role: roleMap.get(String(row.id)) ?? ""
  }));
  return result.length ? result : [current];
}

async function resolveBranch(
  scope: Awaited<ReturnType<typeof requirePosSession>>,
  requested: string | null
) {
  const target = safeText(requested, 70) || scope.session.branch_id;
  const branches = await accessibleBranches(scope);
  const branch = branches.find((item) => item.id === target);
  if (!branch) throw new Error("forbidden_branch_scope");
  await requireTenantFeature(scope.session.tenant_id, "stock_management", branch.id);
  return { branch, branches };
}

async function audit(
  scope: Awaited<ReturnType<typeof requirePosSession>>,
  branchId: string,
  action: string,
  table: string,
  targetId: string
) {
  const result = await appendAuditLog({
    tenantId: scope.session.tenant_id,
    branchId,
    actorUserId: scope.session.user_id,
    actorRole: scope.session.role as "owner" | "manager",
    action,
    targetTable: table,
    targetId,
    metadata: { source: "native_pos_2", device_code: scope.session.device_code }
  });
  if (!result.inserted) console.warn("[native-catalog] audit_write_failed", action, targetId);
}

export async function GET(req: Request) {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "inventory:view");
    const url = new URL(req.url);
    const view = safeText(url.searchParams.get("view"), 30) || "products";

    if (view === "branches") {
      const branches = await accessibleBranches(scope);
      return ok({
        branches,
        selected_branch_id: scope.session.branch_id,
        can_manage_multiple_branches: canManage(scope.session.role) && branches.length > 1
      }, scope.session.id);
    }

    const { branch, branches } = await resolveBranch(scope, url.searchParams.get("branch_id"));
    const page = Math.max(1, Math.min(10000, Number(url.searchParams.get("page")) || 1));
    const pageSize = Math.max(1, Math.min(50, Number(url.searchParams.get("page_size")) || 20));
    const start = (page - 1) * pageSize;
    const search = safeText(url.searchParams.get("search"), 60).replace(/[%_,]/g, "");
    const db = getSupabaseServiceClient();

    if (view === "ingredients") {
      let query = db.from("ingredients")
        .select("id,name,base_unit,quantity_on_hand,reorder_level,avg_unit_cost,last_purchase_unit_cost,updated_at", { count: "exact" })
        .eq("tenant_id", scope.session.tenant_id)
        .eq("branch_id", branch.id)
        .not("name", "ilike", ARCHIVED_INGREDIENT_PREFIX + "%")
        .not("name", "ilike", FALLBACK_INGREDIENT_PREFIX + "%")
        .order("updated_at", { ascending: false })
        .range(start, start + pageSize - 1);
      if (search) query = query.ilike("name", "%" + search + "%");
      const rows = await query;
      if (rows.error) return fail("ingredients_query_failed", 500);
      return ok({
        view,
        items: rows.data ?? [],
        can_edit: canManage(branch.role),
        branch_id: branch.id,
        branch_name: branch.name,
        branches,
        pagination: {
          page,
          page_size: pageSize,
          total: rows.count ?? 0,
          total_pages: Math.max(1, Math.ceil((rows.count ?? 0) / pageSize))
        }
      }, scope.session.id);
    }

    let query = db.from("products")
      .select("id,sku,name,category,price,stock_deduction_mode,is_active,updated_at,metadata", { count: "exact" })
      .eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", branch.id)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .range(start, start + pageSize - 1);
    if (search) query = query.or("name.ilike.%" + search + "%,sku.ilike.%" + search + "%");
    const category = safeText(url.searchParams.get("category"), 80);
    if (category) query = query.eq("category", category);
    const productsResult = await query;
    if (productsResult.error) return fail("products_query_failed", 500);

    const products = productsResult.data ?? [];
    const ids = products.map((row) => String(row.id));
    const stock = new Map<string, number | null>();
    const sold = new Map<string, number | null>();

    if (ids.length) {
      const recipes = await db.from("recipes")
        .select("product_id,quantity_per_item,ingredients(quantity_on_hand)")
        .eq("tenant_id", scope.session.tenant_id)
        .eq("branch_id", branch.id)
        .eq("applies_when_takeaway_only", false)
        .in("product_id", ids);
      if (!recipes.error) {
        for (const row of recipes.data ?? []) {
          const id = String(row.product_id);
          const ingredient = Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients;
          const qty = Number((ingredient as { quantity_on_hand?: number } | null)?.quantity_on_hand);
          const perItem = Number(row.quantity_per_item);
          const count = Number.isFinite(qty) && Number.isFinite(perItem) && perItem > 0
            ? Math.max(0, Math.floor(qty / perItem))
            : null;
          if (!stock.has(id)) stock.set(id, count);
          else {
            const previous = stock.get(id);
            stock.set(id, previous == null || count == null ? null : Math.min(previous, count));
          }
        }
      }

      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const orders = await db.from("orders").select("id")
        .eq("tenant_id", scope.session.tenant_id)
        .eq("branch_id", branch.id)
        .eq("status", "completed")
        .gte("created_at", since)
        .limit(2001);
      if (!orders.error && (orders.data ?? []).length <= 2000) {
        const orderIds = (orders.data ?? []).map((row) => String(row.id));
        if (!orderIds.length) ids.forEach((id) => sold.set(id, 0));
        else {
          const sales = await db.from("order_items").select("product_id,quantity")
            .eq("tenant_id", scope.session.tenant_id)
            .eq("branch_id", branch.id)
            .in("order_id", orderIds)
            .in("product_id", ids)
            .limit(5001);
          if (!sales.error && (sales.data ?? []).length <= 5000) {
            ids.forEach((id) => sold.set(id, 0));
            for (const row of sales.data ?? []) {
              const id = String(row.product_id);
              sold.set(id, (sold.get(id) ?? 0) + Number(row.quantity ?? 0));
            }
          }
        }
      }
    }

    const categoriesResult = await db.from("products")
      .select("category")
      .eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", branch.id)
      .eq("is_active", true)
      .limit(5000);
    const categories = Array.from(new Set((categoriesResult.data ?? [])
      .map((row) => String(row.category ?? "").trim())
      .filter(Boolean))).sort((a, b) => a.localeCompare(b, "th"));

    return ok({
      view: "products",
      items: products.map((row) => ({
        ...row,
        is_recommended: isProductRecommended(row.metadata),
        stock_remaining: stock.get(String(row.id)) ?? null,
        sold_30d: sold.get(String(row.id)) ?? null
      })),
      categories,
      can_edit: canManage(branch.role),
      branch_id: branch.id,
      branch_name: branch.name,
      branches,
      pagination: {
        page,
        page_size: pageSize,
        total: productsResult.count ?? 0,
        total_pages: Math.max(1, Math.ceil((productsResult.count ?? 0) / pageSize))
      }
    }, scope.session.id);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req: Request) {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "inventory:view");
    if (!canManage(scope.session.role)) return fail("catalog_manager_required", 403);

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail("invalid_payload");
    const { branch } = await resolveBranch(scope, typeof body.branch_id === "string" ? body.branch_id : null);
    if (!canManage(branch.role)) return fail("catalog_manager_required", 403);

    const db = getSupabaseServiceClient();
    const tenantId = scope.session.tenant_id;
    const branchId = branch.id;
    const action = String(body.action ?? "");

    if (action === "create_product_with_stock_setup") {
      const name = safeText(body.name);
      const category = safeText(body.category, 80);
      const sku = normalizeSku(body.sku);
      const stockQuantity = Number(body.stock_quantity ?? 0);
      const storePrice = Number(body.store_price ?? 0);
      const deliveryPrice = Number(body.delivery_price ?? storePrice);
      const isRecommended = body.is_recommended === true;
      const useIngredientRecipe = body.use_ingredient_recipe === true;
      const ingredientLines = Array.isArray(body.ingredient_lines)
        ? body.ingredient_lines as Array<Record<string, unknown>>
        : [];

      if (!name || !category) return fail("invalid_product_fields");
      if (!Number.isFinite(stockQuantity) || stockQuantity < 0) return fail("invalid_stock_quantity");
      if (!Number.isFinite(storePrice) || storePrice < 0) return fail("invalid_store_price");
      if (!Number.isFinite(deliveryPrice) || deliveryPrice < 0) return fail("invalid_delivery_price");

      const normalizedRecipeLines = ingredientLines.map((line) => ({
        ingredientId: safeText(line.ingredient_id, 70),
        quantity: Number(line.quantity),
        unit: normalizeRecipeUnit(line.quantity_unit)
      })).filter((line) => line.ingredientId && Number.isFinite(line.quantity) && line.quantity > 0);
      if (useIngredientRecipe && !normalizedRecipeLines.length) return fail("missing_recipe_lines");

      const categoryWrite = await db.from("product_categories").upsert({
        tenant_id: tenantId,
        branch_id: branchId,
        name: category,
        created_by: scope.session.user_id
      }, { onConflict: "tenant_id,branch_id,name" });
      if (categoryWrite.error && !String(categoryWrite.error.message ?? "").includes("product_categories")) {
        return fail("category_create_failed", 500);
      }

      const productInsert = await db.from("products").insert({
        tenant_id: tenantId,
        branch_id: branchId,
        sku,
        name,
        category,
        price: Number(storePrice.toFixed(2)),
        sell_unit: "ชิ้น",
        stock_deduction_mode: "recipe_deduction",
        is_active: true,
        metadata: withProductRecommendedMetadata(null, isRecommended)
      }).select("id,sku,name,category,price,updated_at").single();
      if (productInsert.error || !productInsert.data) return fail("product_create_failed", 409);

      const productId = String(productInsert.data.id);
      let fallbackIngredientId: string | null = null;
      try {
        const channelSource = (body.delivery_prices_by_channel && typeof body.delivery_prices_by_channel === "object")
          ? body.delivery_prices_by_channel as Record<string, unknown>
          : {};
        const channelRows = DELIVERY_CHANNELS.map((channel) => {
          const value = Number(channelSource[channel] ?? deliveryPrice);
          return {
            tenant_id: tenantId,
            branch_id: branchId,
            product_id: productId,
            channel,
            app_price: Number((Number.isFinite(value) && value >= 0 ? value : deliveryPrice).toFixed(2)),
            is_active: true,
            created_by: scope.session.user_id,
            updated_by: scope.session.user_id
          };
        });
        const priceResult = await db.from("product_channel_prices")
          .upsert(channelRows, { onConflict: "tenant_id,branch_id,product_id,channel" });
        if (priceResult.error) throw new Error("product_channel_prices_failed");

        if (useIngredientRecipe) {
          const ingredientIds = normalizedRecipeLines.map((line) => line.ingredientId);
          const ingredientRows = await db.from("ingredients").select("id,base_unit")
            .eq("tenant_id", tenantId).eq("branch_id", branchId).in("id", ingredientIds);
          if (ingredientRows.error) throw new Error("ingredient_query_failed");
          const unitMap = new Map((ingredientRows.data ?? []).map((row) => [String(row.id), String(row.base_unit ?? "")]));
          if (unitMap.size !== new Set(ingredientIds).size) throw new Error("ingredient_not_found");

          const recipeRows = normalizedRecipeLines.map((line) => ({
            tenant_id: tenantId,
            branch_id: branchId,
            product_id: productId,
            ingredient_id: line.ingredientId,
            quantity_per_item: recipeQuantityForBaseUnit({
              quantity: line.quantity,
              quantityUnit: line.unit,
              baseUnit: unitMap.get(line.ingredientId) ?? "gram"
            }),
            applies_when_takeaway_only: false
          }));
          const recipeResult = await db.from("recipes")
            .upsert(recipeRows, { onConflict: "product_id,ingredient_id,applies_when_takeaway_only" });
          if (recipeResult.error) throw new Error("recipe_create_failed");
        } else {
          const fallback = await db.from("ingredients").insert({
            tenant_id: tenantId,
            branch_id: branchId,
            name: (FALLBACK_INGREDIENT_PREFIX + sku + ":" + name).slice(0, 120),
            base_unit: "piece",
            quantity_on_hand: round3(stockQuantity),
            reorder_level: 0
          }).select("id").single();
          if (fallback.error || !fallback.data) throw new Error("fallback_stock_create_failed");
          fallbackIngredientId = String(fallback.data.id);

          const recipe = await db.from("recipes").insert({
            tenant_id: tenantId,
            branch_id: branchId,
            product_id: productId,
            ingredient_id: fallbackIngredientId,
            quantity_per_item: 1,
            applies_when_takeaway_only: false
          });
          if (recipe.error) throw new Error("fallback_recipe_create_failed");
        }

        await audit(scope, branchId, "native_catalog_product_create", "products", productId);
        return ok({
          product: productInsert.data,
          stock_tracking: useIngredientRecipe ? "ingredient_recipe" : "unit_piece_recipe_bridge",
          branch_id: branchId,
          branch_name: branch.name
        }, scope.session.id, 201);
      } catch (error) {
        await db.from("recipes").delete().eq("tenant_id", tenantId).eq("branch_id", branchId).eq("product_id", productId);
        await db.from("product_channel_prices").delete().eq("tenant_id", tenantId).eq("branch_id", branchId).eq("product_id", productId);
        await db.from("products").delete().eq("tenant_id", tenantId).eq("branch_id", branchId).eq("id", productId);
        if (fallbackIngredientId) {
          await db.from("ingredients").delete().eq("tenant_id", tenantId).eq("branch_id", branchId).eq("id", fallbackIngredientId);
        }
        throw error;
      }
    }

    if (action === "add_ingredient_stock") {
      const ingredientId = safeText(body.ingredient_id, 70);
      const ingredientName = safeText(body.ingredient_name);
      const purchaseQuantity = Number(body.purchase_quantity);
      const purchaseUnit = safeText(body.purchase_unit, 20).toLowerCase();
      const bagWeight = Number(body.weight_per_bag_in_grams);
      const totalCost = Number(body.received_total_cost ?? 0);
      const reason = safeText(body.reason, 300) || "เติมสต๊อกจากการรับเข้า";
      if (!ingredientId && !ingredientName) return fail("invalid_ingredient_identity");
      if (!Number.isFinite(purchaseQuantity) || purchaseQuantity <= 0) return fail("invalid_quantity_delta");
      if (!Number.isFinite(totalCost) || totalCost < 0) return fail("invalid_received_total_cost");

      let resolvedId = ingredientId;
      if (!resolvedId) {
        const existing = await db.from("ingredients").select("id")
          .eq("tenant_id", tenantId).eq("branch_id", branchId).eq("name", ingredientName).maybeSingle();
        if (existing.error) return fail("ingredient_query_failed", 500);
        if (existing.data) resolvedId = String(existing.data.id);
        else {
          const baseUnit = ["piece", "unit", "ลูก"].includes(purchaseUnit) ? "piece" : "gram";
          const created = await db.from("ingredients").insert({
            tenant_id: tenantId, branch_id: branchId, name: ingredientName,
            base_unit: baseUnit, quantity_on_hand: 0, reorder_level: 0,
            avg_unit_cost: 0, last_purchase_unit_cost: 0
          }).select("id").single();
          if (created.error || !created.data) return fail("ingredient_insert_failed", 500);
          resolvedId = String(created.data.id);
        }
      }

      const ingredient = await db.from("ingredients")
        .select("id,name,base_unit,quantity_on_hand,avg_unit_cost")
        .eq("tenant_id", tenantId).eq("branch_id", branchId).eq("id", resolvedId).maybeSingle();
      if (ingredient.error || !ingredient.data) return fail("ingredient_not_found", 404);

      let delta: number;
      try {
        if (isPieceBaseUnit(ingredient.data.base_unit)) {
          if (!["piece", "unit", "ลูก"].includes(purchaseUnit)) return fail("invalid_piece_purchase_unit");
          delta = toIntegerGrams(purchaseQuantity);
        } else {
          delta = convertToGrams(purchaseQuantity, purchaseUnit as "kg" | "kilogram" | "gram" | "g" | "khid" | "bag" | "piece" | "unit" | "ลูก", {
            weightPerBagInGrams: purchaseUnit === "bag" ? bagWeight : undefined
          });
        }
      } catch {
        return fail("invalid_quantity_delta");
      }
      if (!Number.isFinite(delta) || delta <= 0) return fail("invalid_quantity_delta");

      const prevQty = Number(ingredient.data.quantity_on_hand ?? 0);
      const prevAvg = Number(ingredient.data.avg_unit_cost ?? 0);
      const nextQty = toIntegerGrams(prevQty + delta);
      const receivedUnitCost = totalCost > 0 ? totalCost / delta : 0;
      const nextAvg = totalCost > 0 && nextQty > 0
        ? (Math.max(0, prevQty) * Math.max(0, prevAvg) + totalCost) / nextQty
        : Math.max(0, prevAvg);

      const updated = await db.from("ingredients").update({
        quantity_on_hand: nextQty,
        avg_unit_cost: round4(nextAvg),
        last_purchase_unit_cost: round4(receivedUnitCost)
      }).eq("tenant_id", tenantId).eq("branch_id", branchId).eq("id", resolvedId);
      if (updated.error) return fail("ingredient_restock_failed", 500);

      const movement = await db.from("stock_movements").insert({
        tenant_id: tenantId,
        branch_id: branchId,
        ingredient_id: resolvedId,
        movement_type: "purchase",
        quantity_delta: toIntegerGrams(delta),
        reason,
        ref_table: "ingredients",
        ref_id: resolvedId,
        created_by: scope.session.user_id
      }).select("id,movement_type,quantity_delta,created_at").single();
      if (movement.error) return fail("stock_movement_insert_failed", 500);
      await audit(scope, branchId, "native_catalog_ingredient_restock", "ingredients", resolvedId);
      return ok({ movement: movement.data, ingredient_id: resolvedId, branch_id: branchId }, scope.session.id, 201);
    }

    if (action === "save_product") {
      const id = safeText(body.id, 70);
      const name = safeText(body.name);
      const sku = safeText(body.sku, 60);
      const category = safeText(body.category, 80);
      const price = Number(body.price);
      if (!id || !name || !sku || !category || !Number.isFinite(price) || price < 0) return fail("invalid_product");
      const previous = await db.from("products").select("updated_at,metadata")
        .eq("tenant_id", tenantId).eq("branch_id", branchId).eq("id", id).maybeSingle();
      if (previous.error || !previous.data) return fail("product_not_found", 404);
      if (safeText(body.updated_at, 80) !== String(previous.data.updated_at ?? "")) return fail("product_changed_reload", 409);
      const patch: Record<string, unknown> = { name, sku, category, price: Number(price.toFixed(2)) };
      if (typeof body.is_recommended === "boolean") {
        patch.metadata = withProductRecommendedMetadata(previous.data.metadata, body.is_recommended);
      }
      const result = await db.from("products").update(patch)
        .eq("tenant_id", tenantId).eq("branch_id", branchId).eq("id", id)
        .eq("updated_at", previous.data.updated_at).select("id").maybeSingle();
      if (result.error) return fail("product_update_failed", 500);
      if (!result.data) return fail("product_changed_reload", 409);
      await audit(scope, branchId, "native_catalog_product_update", "products", id);
      return ok({ id }, scope.session.id);
    }

    if (action === "save_ingredient") {
      const id = safeText(body.id, 70);
      const name = safeText(body.name);
      const unit = safeText(body.base_unit, 32);
      if (!id || !name || !unit) return fail("invalid_ingredient");
      const previous = await db.from("ingredients").select("updated_at,base_unit")
        .eq("tenant_id", tenantId).eq("branch_id", branchId).eq("id", id).maybeSingle();
      if (previous.error || !previous.data) return fail("ingredient_not_found", 404);
      if (safeText(body.updated_at, 80) !== String(previous.data.updated_at ?? "")) return fail("ingredient_changed_reload", 409);
      if (unit !== previous.data.base_unit) return fail("ingredient_unit_locked", 409);
      const result = await db.from("ingredients").update({ name })
        .eq("tenant_id", tenantId).eq("branch_id", branchId).eq("id", id)
        .eq("updated_at", previous.data.updated_at).select("id").maybeSingle();
      if (result.error) return fail("ingredient_update_failed", 500);
      if (!result.data) return fail("ingredient_changed_reload", 409);
      await audit(scope, branchId, "native_catalog_ingredient_update", "ingredients", id);
      return ok({ id }, scope.session.id);
    }

    if (action === "deactivate_product") {
      const id = safeText(body.id, 70);
      const approvalId = safeText(body.approval_id, 70);
      if (!id || !/^[a-f0-9-]{36}$/i.test(approvalId)) return fail("product_deactivate_pin_required", 403);
      const approval = await db.from("manager_pin_approvals")
        .select("id,action,target_table,target_id,approved_by,requested_by,branch_id,expires_at,consumed_at")
        .eq("tenant_id", tenantId).eq("branch_id", branchId)
        .eq("requested_by", scope.session.user_id).eq("id", approvalId).maybeSingle();
      if (approval.error) return fail("product_deactivate_approval_lookup_failed", 503);
      const token = approval.data;
      if (!token || token.action !== "product_deactivate" || token.target_table !== "products" ||
        token.target_id !== id || !token.approved_by || token.consumed_at ||
        !token.expires_at || Date.parse(token.expires_at) <= Date.now()) {
        return fail("product_deactivate_pin_invalid_or_expired", 403);
      }
      const consumed = await db.from("manager_pin_approvals")
        .update({ consumed_at: new Date().toISOString() })
        .eq("tenant_id", tenantId).eq("branch_id", branchId)
        .eq("id", approvalId).is("consumed_at", null).select("id").maybeSingle();
      if (consumed.error || !consumed.data) return fail("product_deactivate_pin_used", 409);

      const result = await db.from("products").update({ is_active: false })
        .eq("tenant_id", tenantId).eq("branch_id", branchId).eq("id", id)
        .eq("is_active", true).select("id").maybeSingle();
      if (result.error) return fail("product_deactivation_failed", 500);
      if (!result.data) return fail("product_not_active", 409);
      await audit(scope, branchId, "native_catalog_product_deactivate", "products", id);
      return ok({ id, deactivated: true }, scope.session.id);
    }

    return fail("unsupported_catalog_action");
  } catch (error) {
    return handleError(error);
  }
}
