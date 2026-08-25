import { randomUUID } from "node:crypto";
import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
import {
  buffetPlanFromProduct,
  buffetPlanModeFromProduct,
  buildBuffetPlanMetadata,
  compareBuffetPlans,
  readBuffetPlanMetadata,
  type BuffetPlanProductRow
} from "@/lib/pos-buffet-plan-product";
import { DEFAULT_BUFFET_PRICE_PLANS, type PosBuffetPricePlan, type PosBuffetPricingMode } from "@/lib/pos-buffet-pricing";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type UpdatePayload = { product_id?: string | null; mode?: PosBuffetPricingMode | string | null; price?: number | string | null };
type CreatePayload = { mode?: PosBuffetPricingMode | string | null };
type DeletePayload = { product_id?: string | null };
type ComboCountRow = { combo_product_id: string };

function roundMoney(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.max(0, value).toFixed(2));
}

function normalizeMode(value: unknown): PosBuffetPricingMode | null {
  return value === "set" ? "set" : value === "per_person" ? "per_person" : null;
}

async function requireBuffetSettingsScope() {
  const scope = await requirePosSession();
  requirePermission(scope, "tables:manage");
  await requireTenantFeature(scope.session.tenant_id, "core_pos_sales", scope.session.branch_id);
  await requireTenantFeature(scope.session.tenant_id, "table_management", scope.session.branch_id);
  return scope;
}

async function loadBranchProducts(tenantId: string, branchId: string) {
  return getSupabaseServiceClient()
    .from("products")
    .select("id,sku,name,price,is_active,metadata,created_at")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .order("created_at", { ascending: true })
    .returns<BuffetPlanProductRow[]>();
}

async function loadItemCounts(tenantId: string, branchId: string, planIds: string[]) {
  if (planIds.length === 0) return new Map<string, number>();
  const { data, error } = await getSupabaseServiceClient()
    .from("product_combo_items")
    .select("combo_product_id")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .in("combo_product_id", planIds)
    .returns<ComboCountRow[]>();
  if (error) throw new Error(error.message);
  const counts = new Map<string, number>();
  for (const row of data ?? []) counts.set(row.combo_product_id, (counts.get(row.combo_product_id) ?? 0) + 1);
  return counts;
}

function mergeCanonicalDefaults(plans: PosBuffetPricePlan[], archivedCodes: Set<string>) {
  const result = [...plans];
  for (const fallback of DEFAULT_BUFFET_PRICE_PLANS) {
    if (archivedCodes.has(fallback.code.toUpperCase())) continue;
    if (!result.some((plan) => plan.code === fallback.code)) {
      result.push({ ...fallback, product_id: null, configured: false, draft: false, item_count: 0 });
    }
  }
  return result.sort(compareBuffetPlans);
}

async function buildSettingsPlans(tenantId: string, branchId: string) {
  const productsResult = await loadBranchProducts(tenantId, branchId);
  if (productsResult.error) throw new Error(productsResult.error.message);
  const allBuffetProducts = (productsResult.data ?? []).filter((product) => buffetPlanModeFromProduct(product) !== null);
  const archivedCodes = new Set(
    allBuffetProducts
      .filter((product) => readBuffetPlanMetadata(product.metadata)?.archived === true)
      .map((product) => String(product.sku ?? "").trim().toUpperCase())
      .filter(Boolean)
  );
  const buffetProducts = allBuffetProducts.filter((product) => readBuffetPlanMetadata(product.metadata)?.archived !== true);
  const counts = await loadItemCounts(tenantId, branchId, buffetProducts.map((product) => product.id));
  const plans = buffetProducts
    .map((product) => buffetPlanFromProduct(product, counts.get(product.id) ?? 0))
    .filter((plan): plan is PosBuffetPricePlan => Boolean(plan));
  return mergeCanonicalDefaults(plans, archivedCodes);
}

async function findProductById(tenantId: string, branchId: string, productId: string) {
  return getSupabaseServiceClient()
    .from("products")
    .select("id,sku,name,price,is_active,metadata,created_at")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("id", productId)
    .maybeSingle<BuffetPlanProductRow>();
}

async function findCanonicalProduct(tenantId: string, branchId: string, mode: PosBuffetPricingMode) {
  const plan = DEFAULT_BUFFET_PRICE_PLANS.find((item) => item.mode === mode)!;
  return getSupabaseServiceClient()
    .from("products")
    .select("id,sku,name,price,is_active,metadata,created_at")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("sku", plan.code)
    .maybeSingle<BuffetPlanProductRow>();
}

async function createCanonicalProduct(args: { tenantId: string; branchId: string; mode: PosBuffetPricingMode; price: number }) {
  const plan = DEFAULT_BUFFET_PRICE_PLANS.find((item) => item.mode === args.mode)!;
  const { data, error } = await getSupabaseServiceClient()
    .from("products")
    .insert({
      tenant_id: args.tenantId,
      branch_id: args.branchId,
      sku: plan.code,
      name: plan.name,
      category: "บุฟเฟ่",
      price: args.price,
      is_combo: false,
      is_active: true,
      stock_deduction_mode: "unit_only",
      metadata: buildBuffetPlanMetadata({ mode: args.mode, draft: false, archived: false })
    })
    .select("id,sku,name,price,is_active,metadata,created_at")
    .maybeSingle<BuffetPlanProductRow>();
  return { product: data ?? null, error: error ?? null };
}

export async function GET() {
  try {
    const scope = await requireBuffetSettingsScope();
    return ok({ plans: await buildSettingsPlans(scope.session.tenant_id, scope.session.branch_id), branch_id: scope.session.branch_id });
  } catch (error) {
    if (error instanceof FeatureGateError) return fail(error.code, error.message, error.status);
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    return fail("buffet_settings_query_failed", error instanceof Error ? error.message : "Unknown error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const scope = await requireBuffetSettingsScope();
    const payload = (await request.json().catch(() => null)) as CreatePayload | null;
    const mode = normalizeMode(payload?.mode);
    if (!mode) return fail("invalid_buffet_mode", "Buffet mode must be per_person or set.", 422);
    const tenantId = scope.session.tenant_id;
    const branchId = scope.session.branch_id;
    const current = await buildSettingsPlans(tenantId, branchId);
    const sameModeCount = current.filter((plan) => plan.mode === mode).length;
    const baseName = mode === "per_person" ? "บุฟเฟ่รายท่าน" : "บุฟเฟ่แบบชุด";
    const name = `${baseName} ${Math.max(2, sameModeCount + 1)}`;
    const prefix = mode === "per_person" ? "BUFFET-PER-PERSON" : "BUFFET-SET";
    const { data, error } = await getSupabaseServiceClient()
      .from("products")
      .insert({
        tenant_id: tenantId,
        branch_id: branchId,
        sku: `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`,
        name,
        category: "บุฟเฟ่",
        price: 0,
        is_combo: false,
        is_active: false,
        stock_deduction_mode: "unit_only",
        metadata: buildBuffetPlanMetadata({ mode, draft: true, archived: false })
      })
      .select("id,sku,name,price,is_active,metadata,created_at")
      .maybeSingle<BuffetPlanProductRow>();
    if (error || !data) return fail("buffet_settings_create_failed", error?.message ?? "Failed to create buffet price row.", 500);
    const plan = buffetPlanFromProduct(data, 0);
    if (!plan) return fail("buffet_settings_create_failed", "Created product is not a buffet plan.", 500);
    return ok({ plan, branch_id: branchId });
  } catch (error) {
    if (error instanceof FeatureGateError) return fail(error.code, error.message, error.status);
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    return fail("buffet_settings_create_failed", error instanceof Error ? error.message : "Unknown error", 500);
  }
}

export async function PUT(request: Request) {
  try {
    const scope = await requireBuffetSettingsScope();
    const payload = (await request.json().catch(() => null)) as UpdatePayload | null;
    const price = roundMoney(Number(payload?.price));
    if (price <= 0) return fail("invalid_buffet_price", "Buffet price must be greater than zero.", 422);
    const tenantId = scope.session.tenant_id;
    const branchId = scope.session.branch_id;
    const requestedProductId = String(payload?.product_id ?? "").trim();
    let product: BuffetPlanProductRow | null = null;

    if (requestedProductId) {
      const existing = await findProductById(tenantId, branchId, requestedProductId);
      if (existing.error) return fail("buffet_settings_query_failed", existing.error.message, 500);
      const mode = existing.data ? buffetPlanModeFromProduct(existing.data) : null;
      const metadata = existing.data ? readBuffetPlanMetadata(existing.data.metadata) : null;
      if (!existing.data || !mode || metadata?.archived) return fail("buffet_plan_not_found", "Buffet plan was not found.", 404);
      const updatePayload: Record<string, unknown> = { price };
      if (metadata?.draft === true) {
        updatePayload.is_active = true;
        updatePayload.metadata = buildBuffetPlanMetadata({ current: existing.data.metadata, mode, draft: false, archived: false, sortOrder: metadata.sort_order });
      }
      const updated = await getSupabaseServiceClient()
        .from("products")
        .update(updatePayload)
        .eq("id", existing.data.id)
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .select("id,sku,name,price,is_active,metadata,created_at")
        .maybeSingle<BuffetPlanProductRow>();
      if (updated.error || !updated.data) return fail("buffet_settings_update_failed", updated.error?.message ?? "Failed to update buffet price.", 500);
      product = updated.data;
    } else {
      const mode = normalizeMode(payload?.mode);
      if (!mode) return fail("invalid_buffet_mode", "Buffet mode must be per_person or set.", 422);
      const existing = await findCanonicalProduct(tenantId, branchId, mode);
      if (existing.error) return fail("buffet_settings_query_failed", existing.error.message, 500);
      if (existing.data && readBuffetPlanMetadata(existing.data.metadata)?.archived === true) {
        const updated = await getSupabaseServiceClient()
          .from("products")
          .update({
            price,
            is_active: true,
            metadata: buildBuffetPlanMetadata({ current: existing.data.metadata, mode, draft: false, archived: false })
          })
          .eq("id", existing.data.id)
          .eq("tenant_id", tenantId)
          .eq("branch_id", branchId)
          .select("id,sku,name,price,is_active,metadata,created_at")
          .maybeSingle<BuffetPlanProductRow>();
        if (updated.error || !updated.data) return fail("buffet_settings_update_failed", updated.error?.message ?? "Failed to restore buffet price.", 500);
        product = updated.data;
      } else if (existing.data) {
        const updated = await getSupabaseServiceClient()
          .from("products")
          .update({ price })
          .eq("id", existing.data.id)
          .eq("tenant_id", tenantId)
          .eq("branch_id", branchId)
          .select("id,sku,name,price,is_active,metadata,created_at")
          .maybeSingle<BuffetPlanProductRow>();
        if (updated.error || !updated.data) return fail("buffet_settings_update_failed", updated.error?.message ?? "Failed to update buffet price.", 500);
        product = updated.data;
      } else {
        const inserted = await createCanonicalProduct({ tenantId, branchId, mode, price });
        if (inserted.error || !inserted.product) return fail("buffet_settings_create_failed", inserted.error?.message ?? "Failed to create buffet product.", 500);
        product = inserted.product;
      }
    }

    const plan = buffetPlanFromProduct(product, 0);
    if (!plan) return fail("buffet_plan_not_found", "Buffet plan was not found after save.", 500);
    return ok({ plan, branch_id: branchId });
  } catch (error) {
    if (error instanceof FeatureGateError) return fail(error.code, error.message, error.status);
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    return fail("buffet_settings_update_failed", error instanceof Error ? error.message : "Unknown error", 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const scope = await requireBuffetSettingsScope();
    const payload = (await request.json().catch(() => null)) as DeletePayload | null;
    const productId = String(payload?.product_id ?? "").trim();
    if (!productId) return fail("buffet_plan_required", "Buffet product_id is required.", 422);
    const tenantId = scope.session.tenant_id;
    const branchId = scope.session.branch_id;
    const existing = await findProductById(tenantId, branchId, productId);
    if (existing.error) return fail("buffet_settings_query_failed", existing.error.message, 500);
    const mode = existing.data ? buffetPlanModeFromProduct(existing.data) : null;
    if (!existing.data || !mode) return fail("buffet_plan_not_found", "Buffet plan was not found.", 404);
    const metadata = readBuffetPlanMetadata(existing.data.metadata);
    const { error } = await getSupabaseServiceClient()
      .from("products")
      .update({
        is_active: false,
        metadata: buildBuffetPlanMetadata({ current: existing.data.metadata, mode, draft: false, archived: true, sortOrder: metadata?.sort_order })
      })
      .eq("id", productId)
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId);
    if (error) return fail("buffet_settings_delete_failed", error.message, 500);
    return ok({ product_id: productId, archived: true });
  } catch (error) {
    if (error instanceof FeatureGateError) return fail(error.code, error.message, error.status);
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    return fail("buffet_settings_delete_failed", error instanceof Error ? error.message : "Unknown error", 500);
  }
}
