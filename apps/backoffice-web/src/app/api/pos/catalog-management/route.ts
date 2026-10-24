import { NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { appendAuditLog } from "@/lib/audit-log";
import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import {
  PosGuardError, requirePosSession, requirePermission, withPosSessionCookie
} from "@/lib/pos-session-guard";

/**
 * Native catalog bridge. Shares authoritative products, recipes and ingredients
 * with Backoffice, but authenticates via a real POS session (not a Supabase key).
 * This endpoint never crosses the signed-in POS session's tenant/branch.
 */
const ARCHIVED = "__archived__:";
const FALLBACK = "STOCK:";
const manageable = (role: string) => role === "owner" || role === "manager";
const safeText = (value: unknown, max = 120) => String(value ?? "").trim().slice(0, max);
const money = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && Math.abs(Math.round(n * 100) - n * 100) < 0.000001 ? n : null;
};
const respond = (data: unknown, sessionId: string) =>
  withPosSessionCookie(NextResponse.json({ data, error: null }), sessionId);
const fail = (code: string, status = 422) =>
  NextResponse.json({ data: null, error: { code, message: code } }, { status });

function handleError(error: unknown) {
  if (error instanceof PosGuardError || error instanceof FeatureGateError) {
    return fail(error.code, error.status);
  }
  console.error("[native-catalog]", error instanceof Error ? error.message : "unknown");
  return fail("catalog_request_failed", 500);
}

export async function GET(req: Request) {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "inventory:view");
    await requireTenantFeature(scope.session.tenant_id, "stock_management", scope.session.branch_id);
    const { tenant_id: tenantId, branch_id: branchId } = scope.session;
    const url = new URL(req.url);
    // No arbitrary branch_id override. Switching branches requires a new
    // registered-device / employee-scoped POS session.
    if (url.searchParams.has("branch_id") &&
      url.searchParams.get("branch_id") !== branchId) return fail("forbidden_branch_scope", 403);
    const view = url.searchParams.get("view") === "ingredients" ? "ingredients" : "products";
    const page = Math.max(1, Math.min(10000, Number(url.searchParams.get("page")) || 1));
    const pageSize = Math.max(1, Math.min(50, Number(url.searchParams.get("page_size")) || 20));
    const search = safeText(url.searchParams.get("search"), 60).replace(/[%_,]/g, "");
    const start = (page - 1) * pageSize;
    const db = getSupabaseServiceClient();
    if (view === "ingredients") {
      let query = db.from("ingredients")
        .select("id,name,base_unit,quantity_on_hand,reorder_level,updated_at", { count: "exact" })
        .eq("tenant_id", tenantId).eq("branch_id", branchId)
        .not("name", "ilike", ARCHIVED + "%")
        .not("name", "ilike", FALLBACK + "%")
        .order("updated_at", { ascending: false }).range(start, start + pageSize - 1);
      if (search) query = query.ilike("name", "%" + search + "%");
      const rows = await query;
      if (rows.error) return fail("ingredients_query_failed", 500);
      return respond({
        view, items: rows.data ?? [], can_edit: manageable(scope.session.role),
        branch_id: branchId, branch_name: scope.branch?.name ?? branchId,
        pagination: { page, page_size: pageSize, total: rows.count ?? 0,
          total_pages: Math.ceil((rows.count ?? 0) / pageSize) }
      }, scope.session.id);
    }

    let query = db.from("products")
      .select("id,sku,name,category,price,stock_deduction_mode,is_active,updated_at", { count: "exact" })
      .eq("tenant_id", tenantId).eq("branch_id", branchId)
      .order("updated_at", { ascending: false }).range(start, start + pageSize - 1);
    if (search) query = query.or("name.ilike.%" + search + "%,sku.ilike.%" + search + "%");
    const category = safeText(url.searchParams.get("category"), 80);
    if (category) query = query.eq("category", category);
    const productResult = await query;
    if (productResult.error) return fail("products_query_failed", 500);
    const products = productResult.data ?? [];
    const ids = products.map(row => String(row.id));
    const stock = new Map<string, number | null>();
    const sold = new Map<string, number | null>();
    if (ids.length) {
      // A recipe yields a sellable quantity only when every required ingredient
      // has measurable stock. Missing recipes/stock must be shown as unknown.
      const recipes = await db.from("recipes")
        .select("product_id,quantity_per_item,ingredients(quantity_on_hand)")
        .eq("tenant_id", tenantId).eq("branch_id", branchId)
        .eq("applies_when_takeaway_only", false).in("product_id", ids);
      if (!recipes.error) {
        for (const row of recipes.data ?? []) {
          const id = String(row.product_id);
          const ingredient = Array.isArray(row.ingredients) ? row.ingredients[0] : row.ingredients;
          const qty = Number((ingredient as { quantity_on_hand?: number } | null)?.quantity_on_hand);
          const perItem = Number(row.quantity_per_item);
          const count = Number.isFinite(qty) && Number.isFinite(perItem) && perItem > 0
            ? Math.max(0, Math.floor(qty / perItem)) : null;
          const previous = stock.get(id);
          stock.set(id, previous == null ? count : count == null ? null : Math.min(previous, count));
        }
      }
      // Completed sales only, last 30 days. A capped data set is explicitly
      // reported as unknown rather than showing incorrect partial totals.
      const from = new Date(Date.now() - 30 * 86400000).toISOString();
      const recentOrders = await db.from("orders").select("id")
        .eq("tenant_id", tenantId).eq("branch_id", branchId)
        .eq("status", "completed").gte("created_at", from).limit(2001);
      if (!recentOrders.error && (recentOrders.data ?? []).length <= 2000) {
        const orderIds = (recentOrders.data ?? []).map(row => String(row.id));
        if (!orderIds.length) ids.forEach(id => sold.set(id, 0));
        else {
          const sales = await db.from("order_items").select("product_id,quantity")
            .eq("tenant_id", tenantId).eq("branch_id", branchId)
            .in("order_id", orderIds).in("product_id", ids).limit(5001);
          if (!sales.error && (sales.data ?? []).length <= 5000) {
            ids.forEach(id => sold.set(id, 0));
            (sales.data ?? []).forEach(row => {
              const id = String(row.product_id);
              sold.set(id, (sold.get(id) ?? 0) + Number(row.quantity ?? 0));
            });
          }
        }
      }
    }
    return respond({
      view, items: products.map(row => ({
        ...row, stock_remaining: stock.get(String(row.id)) ?? null,
        sold_30d: sold.get(String(row.id)) ?? null
      })), can_edit: manageable(scope.session.role),
      branch_id: branchId, branch_name: scope.branch?.name ?? branchId,
      pagination: { page, page_size: pageSize, total: productResult.count ?? 0,
        total_pages: Math.ceil((productResult.count ?? 0) / pageSize) }
    }, scope.session.id);
  } catch (error) { return handleError(error); }
}

export async function POST(req: Request) {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "inventory:view");
    await requireTenantFeature(scope.session.tenant_id, "stock_management", scope.session.branch_id);
    if (!manageable(scope.session.role)) return fail("catalog_manager_required", 403);
    const { tenant_id: tenantId, branch_id: branchId } = scope.session;
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return fail("invalid_payload");
    if (body.branch_id != null && body.branch_id !== branchId) return fail("forbidden_branch_scope", 403);
    const db = getSupabaseServiceClient();
    const action = String(body.action ?? "");
    const id = safeText(body.id, 70);
    const recordAudit = (actionName: string, table: string, targetId: string) => {
      void appendAuditLog({
        tenantId, branchId, actorUserId: scope.session.user_id,
        actorRole: scope.session.role as "owner" | "manager",
        action: actionName, targetTable: table, targetId,
        metadata: { source: "native_pos_2", device_code: scope.session.device_code }
      }).catch(() => console.error("[native-catalog] audit_write_failed"));
    };
    if (action === "save_product") {
      const name = safeText(body.name);
      const sku = safeText(body.sku, 60);
      const category = safeText(body.category, 80);
      const price = money(body.price);
      if (!name || !sku || !category || price === null || price <= 0) return fail("invalid_product");
      const data = { name, sku, category, price };
      if (id) {
        const previous = await db.from("products").select("id,updated_at")
          .eq("tenant_id", tenantId).eq("branch_id", branchId).eq("id", id).maybeSingle();
        if (previous.error || !previous.data) return fail("product_not_found", 404);
        if (body.updated_at !== previous.data.updated_at) return fail("product_changed_reload", 409);
        const result = await db.from("products").update(data)
          .eq("tenant_id", tenantId).eq("branch_id", branchId).eq("id", id)
          .eq("updated_at", previous.data.updated_at).select("id").maybeSingle();
        if (result.error) return fail("product_update_failed", 500);
        if (!result.data) return fail("product_changed_reload", 409);
        recordAudit("native_catalog_product_update", "products", id);
        return respond({ id }, scope.session.id);
      }
      const result = await db.from("products")
        .insert({ ...data, tenant_id: tenantId, branch_id: branchId, is_active: true,
          stock_deduction_mode: "unit_only" }).select("id").single();
      if (result.error) return fail("product_create_failed", 409);
      recordAudit("native_catalog_product_create", "products", result.data.id);
      return respond({ id: result.data.id }, scope.session.id);
    }
    if (action === "deactivate_product") {
      if (!id) return fail("product_id_required");
      const result = await db.from("products").update({ is_active: false })
        .eq("tenant_id", tenantId).eq("branch_id", branchId).eq("id", id)
        .eq("is_active", true).select("id").maybeSingle();
      if (result.error) return fail("product_deactivation_failed", 500);
      if (!result.data) return fail("product_not_active", 409);
      recordAudit("native_catalog_product_deactivate", "products", id);
      return respond({ id, deactivated: true }, scope.session.id);
    }
    if (action === "save_ingredient") {
      const name = safeText(body.name);
      const unit = safeText(body.base_unit, 32);
      if (!name || !unit) return fail("invalid_ingredient");
      if (id) {
        const prev = await db.from("ingredients").select("id,updated_at,base_unit")
          .eq("tenant_id", tenantId).eq("branch_id", branchId).eq("id", id).maybeSingle();
        if (prev.error || !prev.data) return fail("ingredient_not_found", 404);
        if (body.updated_at !== prev.data.updated_at) return fail("ingredient_changed_reload", 409);
        // Unit changes require recipe and stock-movement migration, not an inline rename.
        if (unit !== prev.data.base_unit) return fail("ingredient_unit_locked", 409);
        const result = await db.from("ingredients").update({ name, base_unit: unit })
          .eq("tenant_id", tenantId).eq("branch_id", branchId).eq("id", id)
          .eq("updated_at", prev.data.updated_at).select("id").maybeSingle();
        if (result.error) return fail("ingredient_update_failed", 500);
        if (!result.data) return fail("ingredient_changed_reload", 409);
        recordAudit("native_catalog_ingredient_update", "ingredients", id);
        return respond({ id }, scope.session.id);
      }
      const result = await db.from("ingredients").insert({
        tenant_id: tenantId, branch_id: branchId, name, base_unit: unit,
        quantity_on_hand: 0, reorder_level: 0
      }).select("id").single();
      if (result.error) return fail("ingredient_create_failed", 409);
      recordAudit("native_catalog_ingredient_create", "ingredients", result.data.id);
      return respond({ id: result.data.id }, scope.session.id);
    }
    // Ingredient stock must be adjusted through audited stock transactions;
    // recipe-linked ingredients must never be hard deleted by Android.
    return fail("unsupported_or_unsafe_catalog_action", 422);
  } catch (error) { return handleError(error); }
}
