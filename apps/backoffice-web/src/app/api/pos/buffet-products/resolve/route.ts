import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
import { DEFAULT_BUFFET_PRICE_PLANS, type PosBuffetPricePlan } from "@/lib/pos-buffet-pricing";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type ResolveBuffetProductPayload = {
  plan_id?: string | null;
  code?: string | null;
  name?: string | null;
  mode?: "per_person" | "set" | string | null;
  price?: number | string | null;
};

type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

type ExistingBuffetProduct = {
  id: string;
  name: string;
  price: number | null;
  is_active: boolean | null;
};

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.max(0, value).toFixed(2));
}

function isMissingColumnError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return code === "42703" || code === "PGRST204" || text.includes("column") || text.includes("schema cache");
}

function isDuplicateError(error: PostgrestLikeError | null | undefined): boolean {
  return String(error?.code ?? "") === "23505";
}

function normalizeMode(value: ResolveBuffetProductPayload["mode"]): "per_person" | "set" {
  return value === "set" ? "set" : "per_person";
}

function buildBuffetProductDescriptor(payload: ResolveBuffetProductPayload) {
  const mode = normalizeMode(payload.mode);
  const defaultPlan = DEFAULT_BUFFET_PRICE_PLANS.find((plan) => plan.mode === mode)!;
  const name = String(payload.name ?? "").trim() || defaultPlan.name;
  const code = String(payload.code ?? "").trim() || defaultPlan.code;
  const price = roundMoney(Number(payload.price ?? defaultPlan.price));
  return { mode, name, code, price, category: "บุฟเฟ่" };
}

async function requireBuffetSalesScope() {
  const scope = await requirePosSession();
  requirePermission(scope, "sales:enter");
  await requireTenantFeature(scope.session.tenant_id, "core_pos_sales", scope.session.branch_id);
  await requireTenantFeature(scope.session.tenant_id, "table_management", scope.session.branch_id);
  return scope;
}

async function findExistingProduct(args: { tenantId: string; branchId: string; name: string }) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select("id,name,price,is_active")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("name", args.name)
    .limit(1)
    .maybeSingle<ExistingBuffetProduct>();
  return { product: data ?? null, error: error ?? null };
}

async function insertBuffetProduct(args: {
  tenantId: string;
  branchId: string;
  code: string;
  name: string;
  category: string;
  price: number;
}) {
  const supabase = getSupabaseServiceClient();
  const candidates: Array<Record<string, unknown>> = [
    {
      tenant_id: args.tenantId,
      branch_id: args.branchId,
      sku: args.code,
      code: args.code,
      name: args.name,
      category: args.category,
      price: args.price,
      is_active: true,
      stock_deduction_mode: "unit_only"
    },
    {
      tenant_id: args.tenantId,
      branch_id: args.branchId,
      sku: args.code,
      name: args.name,
      category: args.category,
      price: args.price,
      is_active: true,
      stock_deduction_mode: "unit_only"
    },
    {
      tenant_id: args.tenantId,
      branch_id: args.branchId,
      name: args.name,
      category: args.category,
      price: args.price,
      is_active: true,
      stock_deduction_mode: "unit_only"
    },
    {
      tenant_id: args.tenantId,
      branch_id: args.branchId,
      name: args.name,
      category: args.category,
      price: args.price,
      is_active: true
    },
    {
      tenant_id: args.tenantId,
      branch_id: args.branchId,
      name: args.name,
      price: args.price,
      is_active: true
    }
  ];

  let lastError: PostgrestLikeError | null = null;
  for (const payload of candidates) {
    const { data, error } = await supabase
      .from("products")
      .insert(payload)
      .select("id,name,price,is_active")
      .maybeSingle<ExistingBuffetProduct>();

    if (!error && data?.id) return { product: data, error: null };

    lastError = error ?? null;
    if (isDuplicateError(error)) {
      const existing = await findExistingProduct({ tenantId: args.tenantId, branchId: args.branchId, name: args.name });
      if (existing.product?.id) return { product: existing.product, error: null };
    }
    if (!isMissingColumnError(error)) continue;
  }

  return { product: null, error: lastError };
}

function planFromProduct(defaultPlan: PosBuffetPricePlan, product: ExistingBuffetProduct | null): PosBuffetPricePlan {
  if (!product) return { ...defaultPlan };
  const price = roundMoney(Number(product.price ?? defaultPlan.price));
  return {
    ...defaultPlan,
    name: product.name || defaultPlan.name,
    price,
    is_active: product.is_active !== false && price > 0,
    description: defaultPlan.description
  };
}

export async function GET() {
  try {
    const scope = await requireBuffetSalesScope();
    const supabase = getSupabaseServiceClient();
    const names = DEFAULT_BUFFET_PRICE_PLANS.map((plan) => plan.name);
    const { data, error } = await supabase
      .from("products")
      .select("id,name,price,is_active")
      .eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", scope.session.branch_id)
      .in("name", names)
      .returns<ExistingBuffetProduct[]>();
    if (error) return fail("buffet_product_query_failed", error.message, 500);

    const byName = new Map((data ?? []).map((product) => [product.name, product]));
    const plans = DEFAULT_BUFFET_PRICE_PLANS.map((plan) => planFromProduct(plan, byName.get(plan.name) ?? null));
    return ok({ plans, source: data?.length ? "branch_products" : "defaults" });
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

    const descriptor = buildBuffetProductDescriptor(payload);
    if (descriptor.price <= 0) return fail("invalid_buffet_price", "Buffet price must be greater than zero.", 422);

    const tenantId = scope.session.tenant_id;
    const branchId = scope.session.branch_id;
    const existing = await findExistingProduct({ tenantId, branchId, name: descriptor.name });
    if (existing.error) return fail("buffet_product_query_failed", existing.error.message ?? "Failed to query buffet product.", 500);

    if (existing.product?.id) {
      if (existing.product.is_active === false) {
        return fail("buffet_product_inactive", "This buffet product is inactive for the current branch.", 409);
      }
      const actualPrice = roundMoney(Number(existing.product.price ?? 0));
      if (actualPrice <= 0) return fail("invalid_buffet_price", "Configured buffet product price must be greater than zero.", 422);
      return ok({
        product_id: existing.product.id,
        name: existing.product.name || descriptor.name,
        price: actualPrice,
        reused: true,
        price_source: "branch_product"
      });
    }

    const inserted = await insertBuffetProduct({
      tenantId,
      branchId,
      code: descriptor.code,
      name: descriptor.name,
      category: descriptor.category,
      price: descriptor.price
    });
    if (!inserted.product?.id) {
      return fail("buffet_product_create_failed", inserted.error?.message ?? "Failed to create buffet product.", 500);
    }

    return ok({
      product_id: inserted.product.id,
      name: inserted.product.name || descriptor.name,
      price: roundMoney(Number(inserted.product.price ?? descriptor.price)),
      reused: false,
      price_source: "created_default"
    });
  } catch (error) {
    if (error instanceof FeatureGateError) return fail(error.code, error.message, error.status);
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    return fail("buffet_product_resolve_failed", error instanceof Error ? error.message : "Unknown error", 500);
  }
}
