import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
import {
  buffetPlanFromProduct,
  buffetPlanModeFromProduct,
  buildBuffetPlanMetadata,
  compareBuffetPlans,
  type BuffetPlanProductRow
} from "@/lib/pos-buffet-plan-product";
import { DEFAULT_BUFFET_PRICE_PLANS, type PosBuffetPricePlan, type PosBuffetPricingMode } from "@/lib/pos-buffet-pricing";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type ResolveBuffetProductPayload = {
  product_id?: string | null;
  plan_id?: string | null;
  code?: string | null;
  name?: string | null;
  mode?: PosBuffetPricingMode | string | null;
  price?: number | string | null;
};

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.max(0, value).toFixed(2));
}

function normalizeMode(value: unknown): PosBuffetPricingMode {
  return value === "set" ? "set" : "per_person";
}

async function requireBuffetSalesScope() {
  const scope = await requirePosSession();
  requirePermission(scope, "sales:enter");
  await requireTenantFeature(scope.session.tenant_id, "core_pos_sales", scope.session.branch_id);
  await requireTenantFeature(scope.session.tenant_id, "table_management", scope.session.branch_id);
  return scope;
}

async function loadBranchProducts(tenantId: string, branchId: string) {
  const supabase = getSupabaseServiceClient();
  return supabase
    .from("products")
    .select("id,sku,name,price,is_active,metadata,created_at")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .order("created_at", { ascending: true })
    .returns<BuffetPlanProductRow[]>();
}

function canonicalPlanForMode(mode: PosBuffetPricingMode) {
  return DEFAULT_BUFFET_PRICE_PLANS.find((plan) => plan.mode === mode)!;
}

async function findProductById(tenantId: string, branchId: string, productId: string) {
  const supabase = getSupabaseServiceClient();
  return supabase
    .from("products")
    .select("id,sku,name,price,is_active,metadata,created_at")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("id", productId)
    .maybeSingle<BuffetPlanProductRow>();
}

async function findCanonicalProduct(tenantId: string, branchId: string, mode: PosBuffetPricingMode) {
  const plan = canonicalPlanForMode(mode);
  const supabase = getSupabaseServiceClient();
  return supabase
    .from("products")
    .select("id,sku,name,price,is_active,metadata,created_at")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("sku", plan.code)
    .maybeSingle<BuffetPlanProductRow>();
}

async function createCanonicalProduct(args: {
  tenantId: string;
  branchId: string;
  mode: PosBuffetPricingMode;
  price: number;
}) {
  const plan = canonicalPlanForMode(args.mode);
  const supabase = getSupabaseServiceClient();
  return supabase
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
      metadata: buildBuffetPlanMetadata({ mode: args.mode, draft: false })
    })
    .select("id,sku,name,price,is_active,metadata,created_at")
    .maybeSingle<BuffetPlanProductRow>();
}

function buildSalesPlans(products: BuffetPlanProductRow[]): PosBuffetPricePlan[] {
  const classified = products
    .filter((product) => buffetPlanModeFromProduct(product) !== null)
    .map((product) => buffetPlanFromProduct(product, 0))
    .filter((plan): plan is PosBuffetPricePlan => Boolean(plan));

  const result = [...classified];
  for (const fallback of DEFAULT_BUFFET_PRICE_PLANS) {
    const existing = result.some((plan) => plan.code === fallback.code);
    if (!existing) result.push({ ...fallback, product_id: null, configured: false, draft: false, item_count: 0 });
  }
  return result.filter((plan) => plan.is_active && plan.price > 0 && !plan.draft).sort(compareBuffetPlans);
}

export async function GET() {
  try {
    const scope = await requireBuffetSalesScope();
    const result = await loadBranchProducts(scope.session.tenant_id, scope.session.branch_id);
    if (result.error) return fail("buffet_product_query_failed", result.error.message, 500);
    const plans = buildSalesPlans(result.data ?? []);
    return ok({ plans, source: "branch_products" });
  } catch (error) {
    if (error instanceof FeatureGateError) return fail(error.code, error.message, error.status);
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    return fail("buffet_product_query_failed", error instanceof Error ? error.message : "Unknown error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const scope = await requireBuffetSalesScope();
    const payload = (await request.json().catch(() => null)) as ResolveBuffetProductPayload | null;
    if (!payload) return fail("invalid_payload", "Invalid buffet product payload.", 422);

    const tenantId = scope.session.tenant_id;
    const branchId = scope.session.branch_id;
    const requestedProductId = String(payload.product_id ?? "").trim();

    if (requestedProductId) {
      const existing = await findProductById(tenantId, branchId, requestedProductId);
      if (existing.error) return fail("buffet_product_query_failed", existing.error.message, 500);
      if (!existing.data || !buffetPlanModeFromProduct(existing.data)) return fail("buffet_plan_not_found", "Buffet plan was not found.", 404);
      const plan = buffetPlanFromProduct(existing.data, 0);
      if (!plan?.is_active || plan.price <= 0 || plan.draft) return fail("buffet_product_inactive", "This buffet plan is not available for sale.", 409);
      return ok({
        product_id: existing.data.id,
        name: existing.data.name,
        price: plan.price,
        reused: true,
        price_source: "branch_product"
      });
    }

    const mode = normalizeMode(payload.mode);
    const fallbackPlan = canonicalPlanForMode(mode);
    const requestedCode = String(payload.code ?? "").trim().toUpperCase();
    if (requestedCode && requestedCode !== fallbackPlan.code) {
      return fail("buffet_plan_product_id_required", "Dynamic buffet plans require product_id.", 422);
    }

    const existing = await findCanonicalProduct(tenantId, branchId, mode);
    if (existing.error) return fail("buffet_product_query_failed", existing.error.message, 500);
    if (existing.data) {
      const plan = buffetPlanFromProduct(existing.data, 0);
      if (!plan?.is_active || plan.price <= 0 || plan.draft) return fail("buffet_product_inactive", "This buffet plan is not available for sale.", 409);
      return ok({
        product_id: existing.data.id,
        name: existing.data.name,
        price: plan.price,
        reused: true,
        price_source: "branch_product"
      });
    }

    const requestedPrice = roundMoney(Number(payload.price ?? fallbackPlan.price));
    if (requestedPrice <= 0) return fail("invalid_buffet_price", "Buffet price must be greater than zero.", 422);
    const inserted = await createCanonicalProduct({ tenantId, branchId, mode, price: requestedPrice });
    if (inserted.error || !inserted.data) return fail("buffet_product_create_failed", inserted.error?.message ?? "Failed to create buffet product.", 500);
    return ok({
      product_id: inserted.data.id,
      name: inserted.data.name,
      price: roundMoney(Number(inserted.data.price ?? requestedPrice)),
      reused: false,
      price_source: "created_default"
    });
  } catch (error) {
    if (error instanceof FeatureGateError) return fail(error.code, error.message, error.status);
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    return fail("buffet_product_resolve_failed", error instanceof Error ? error.message : "Unknown error", 500);
  }
}
