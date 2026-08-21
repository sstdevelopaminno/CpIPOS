import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
import { buffetPlanFromProduct, buffetPlanModeFromProduct, type BuffetPlanProductRow } from "@/lib/pos-buffet-plan-product";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type ProductRow = BuffetPlanProductRow & {
  category?: string | null;
};

type ItemRow = {
  combo_product_id: string;
  child_product_id: string;
  qty: number | null;
};

type SavePayload = {
  plan_id?: string | null;
  product_ids?: string[] | null;
};

async function requireBuffetItemsScope() {
  const scope = await requirePosSession();
  requirePermission(scope, "tables:manage");
  await requireTenantFeature(scope.session.tenant_id, "core_pos_sales", scope.session.branch_id);
  await requireTenantFeature(scope.session.tenant_id, "table_management", scope.session.branch_id);
  return scope;
}

async function loadPlan(tenantId: string, branchId: string, planId: string) {
  const supabase = getSupabaseServiceClient();
  return supabase
    .from("products")
    .select("id,sku,name,price,is_active,metadata,created_at")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("id", planId)
    .maybeSingle<BuffetPlanProductRow>();
}

export async function GET(request: Request) {
  try {
    const scope = await requireBuffetItemsScope();
    const url = new URL(request.url);
    const requestedPlanId = String(url.searchParams.get("plan_id") ?? "").trim();
    const tenantId = scope.session.tenant_id;
    const branchId = scope.session.branch_id;
    const supabase = getSupabaseServiceClient();

    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id,sku,name,category,price,is_active,metadata,created_at")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("is_active", true)
      .order("category", { ascending: true })
      .order("name", { ascending: true })
      .returns<ProductRow[]>();
    if (productsError) return fail("buffet_items_products_query_failed", productsError.message, 500);

    const plans = (products ?? [])
      .filter((product) => buffetPlanModeFromProduct(product) !== null)
      .map((product) => buffetPlanFromProduct(product, 0))
      .filter((plan) => Boolean(plan && plan.price > 0 && !plan.draft));
    const foods = (products ?? [])
      .filter((product) => buffetPlanModeFromProduct(product) === null)
      .map((product) => ({
        id: product.id,
        sku: product.sku,
        name: product.name,
        category: product.category ?? "",
        price: Number(product.price ?? 0)
      }));

    let selected_product_ids: string[] = [];
    if (requestedPlanId) {
      const planResult = await loadPlan(tenantId, branchId, requestedPlanId);
      if (planResult.error) return fail("buffet_plan_query_failed", planResult.error.message, 500);
      if (!planResult.data || !buffetPlanModeFromProduct(planResult.data)) return fail("buffet_plan_not_found", "Buffet plan was not found.", 404);
      const { data: itemRows, error: itemsError } = await supabase
        .from("product_combo_items")
        .select("combo_product_id,child_product_id,qty")
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .eq("combo_product_id", requestedPlanId)
        .returns<ItemRow[]>();
      if (itemsError) return fail("buffet_items_query_failed", itemsError.message, 500);
      selected_product_ids = (itemRows ?? []).map((row) => row.child_product_id);
    }

    return ok({ plans, products: foods, selected_product_ids, branch_id: branchId });
  } catch (error) {
    if (error instanceof FeatureGateError) return fail(error.code, error.message, error.status);
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    return fail("buffet_items_query_failed", error instanceof Error ? error.message : "Unknown error", 500);
  }
}

export async function PUT(request: Request) {
  try {
    const scope = await requireBuffetItemsScope();
    const payload = (await request.json().catch(() => null)) as SavePayload | null;
    const planId = String(payload?.plan_id ?? "").trim();
    const requestedIds = Array.isArray(payload?.product_ids)
      ? Array.from(new Set(payload.product_ids.map((value) => String(value ?? "").trim()).filter(Boolean)))
      : [];
    if (!planId) return fail("buffet_plan_required", "Buffet plan is required.", 422);

    const tenantId = scope.session.tenant_id;
    const branchId = scope.session.branch_id;
    const planResult = await loadPlan(tenantId, branchId, planId);
    if (planResult.error) return fail("buffet_plan_query_failed", planResult.error.message, 500);
    if (!planResult.data || !buffetPlanModeFromProduct(planResult.data)) return fail("buffet_plan_not_found", "Buffet plan was not found.", 404);

    const supabase = getSupabaseServiceClient();
    if (requestedIds.length > 0) {
      const { data: validProducts, error: validError } = await supabase
        .from("products")
        .select("id,sku,name,metadata")
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .eq("is_active", true)
        .in("id", requestedIds)
        .returns<Array<{ id: string; sku: string | null; name: string; metadata?: Record<string, unknown> | null }>>();
      if (validError) return fail("buffet_items_products_query_failed", validError.message, 500);
      const validIds = (validProducts ?? []).filter((product) => !buffetPlanModeFromProduct(product)).map((product) => product.id);
      if (validIds.length !== requestedIds.length) return fail("buffet_items_invalid_product", "One or more selected products are unavailable or are buffet price plans.", 422);

      const upsertRows = validIds.map((productId) => ({
        tenant_id: tenantId,
        branch_id: branchId,
        combo_product_id: planId,
        child_product_id: productId,
        qty: 1
      }));
      const upsert = await supabase
        .from("product_combo_items")
        .upsert(upsertRows, { onConflict: "combo_product_id,child_product_id" });
      if (upsert.error) return fail("buffet_items_save_failed", upsert.error.message, 500);
    }

    const current = await supabase
      .from("product_combo_items")
      .select("child_product_id")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .eq("combo_product_id", planId)
      .returns<Array<{ child_product_id: string }>>();
    if (current.error) return fail("buffet_items_query_failed", current.error.message, 500);
    const removeIds = (current.data ?? []).map((row) => row.child_product_id).filter((id) => !requestedIds.includes(id));
    if (removeIds.length > 0) {
      const removed = await supabase
        .from("product_combo_items")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .eq("combo_product_id", planId)
        .in("child_product_id", removeIds);
      if (removed.error) return fail("buffet_items_save_failed", removed.error.message, 500);
    }

    return ok({ plan_id: planId, selected_product_ids: requestedIds, item_count: requestedIds.length });
  } catch (error) {
    if (error instanceof FeatureGateError) return fail(error.code, error.message, error.status);
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    return fail("buffet_items_save_failed", error instanceof Error ? error.message : "Unknown error", 500);
  }
}
