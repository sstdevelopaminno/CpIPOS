import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
import { DEFAULT_BUFFET_PRICE_PLANS, type PosBuffetPricePlan, type PosBuffetPricingMode } from "@/lib/pos-buffet-pricing";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type BuffetProductRow = {
  id: string;
  name: string;
  price: number | null;
  is_active: boolean | null;
};

type UpdatePayload = {
  mode?: PosBuffetPricingMode | string | null;
  price?: number | string | null;
};

type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function roundMoney(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.max(0, value).toFixed(2));
}

function isMissingColumnError(error: PostgrestLikeError | null | undefined) {
  if (!error) return false;
  const code = String(error.code ?? "");
  const text = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return code === "42703" || code === "PGRST204" || text.includes("column") || text.includes("schema cache");
}

function isDuplicateError(error: PostgrestLikeError | null | undefined) {
  return String(error?.code ?? "") === "23505";
}

async function requireBuffetSettingsScope() {
  const scope = await requirePosSession();
  requirePermission(scope, "tables:manage");
  await requireTenantFeature(scope.session.tenant_id, "core_pos_sales", scope.session.branch_id);
  await requireTenantFeature(scope.session.tenant_id, "table_management", scope.session.branch_id);
  return scope;
}

function planFromProduct(defaultPlan: PosBuffetPricePlan, product: BuffetProductRow | null) {
  const price = product ? roundMoney(Number(product.price ?? defaultPlan.price)) : defaultPlan.price;
  return {
    ...defaultPlan,
    price,
    is_active: product ? product.is_active !== false && price > 0 : defaultPlan.is_active,
    product_id: product?.id ?? null,
    configured: Boolean(product?.id)
  };
}

async function findProduct(tenantId: string, branchId: string, name: string) {
  const supabase = getSupabaseServiceClient();
  return supabase
    .from("products")
    .select("id,name,price,is_active")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("name", name)
    .limit(1)
    .maybeSingle<BuffetProductRow>();
}

async function insertProduct(args: {
  tenantId: string;
  branchId: string;
  plan: PosBuffetPricePlan;
  price: number;
}) {
  const supabase = getSupabaseServiceClient();
  const candidates: Array<Record<string, unknown>> = [
    {
      tenant_id: args.tenantId,
      branch_id: args.branchId,
      sku: args.plan.code,
      code: args.plan.code,
      name: args.plan.name,
      category: "บุฟเฟ่",
      price: args.price,
      is_active: true,
      stock_deduction_mode: "unit_only"
    },
    {
      tenant_id: args.tenantId,
      branch_id: args.branchId,
      sku: args.plan.code,
      name: args.plan.name,
      category: "บุฟเฟ่",
      price: args.price,
      is_active: true,
      stock_deduction_mode: "unit_only"
    },
    {
      tenant_id: args.tenantId,
      branch_id: args.branchId,
      name: args.plan.name,
      category: "บุฟเฟ่",
      price: args.price,
      is_active: true,
      stock_deduction_mode: "unit_only"
    },
    {
      tenant_id: args.tenantId,
      branch_id: args.branchId,
      name: args.plan.name,
      category: "บุฟเฟ่",
      price: args.price,
      is_active: true
    },
    {
      tenant_id: args.tenantId,
      branch_id: args.branchId,
      name: args.plan.name,
      price: args.price,
      is_active: true
    }
  ];

  let lastError: PostgrestLikeError | null = null;
  for (const payload of candidates) {
    const result = await supabase
      .from("products")
      .insert(payload)
      .select("id,name,price,is_active")
      .maybeSingle<BuffetProductRow>();
    if (!result.error && result.data?.id) return { product: result.data, error: null };
    lastError = result.error ?? null;
    if (isDuplicateError(result.error)) {
      const existing = await findProduct(args.tenantId, args.branchId, args.plan.name);
      if (existing.data?.id) return { product: existing.data, error: null };
    }
    if (!isMissingColumnError(result.error)) break;
  }
  return { product: null, error: lastError };
}

export async function GET() {
  try {
    const scope = await requireBuffetSettingsScope();
    const supabase = getSupabaseServiceClient();
    const names = DEFAULT_BUFFET_PRICE_PLANS.map((plan) => plan.name);
    const { data, error } = await supabase
      .from("products")
      .select("id,name,price,is_active")
      .eq("tenant_id", scope.session.tenant_id)
      .eq("branch_id", scope.session.branch_id)
      .in("name", names)
      .returns<BuffetProductRow[]>();
    if (error) return fail("buffet_settings_query_failed", error.message, 500);

    const byName = new Map((data ?? []).map((product) => [product.name, product]));
    const plans = DEFAULT_BUFFET_PRICE_PLANS.map((plan) => planFromProduct(plan, byName.get(plan.name) ?? null));
    return ok({ plans, branch_id: scope.session.branch_id });
  } catch (error) {
    if (error instanceof FeatureGateError) return fail(error.code, error.message, error.status);
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    return fail("buffet_settings_query_failed", error instanceof Error ? error.message : "Unknown error", 500);
  }
}

export async function PUT(request: Request) {
  try {
    const scope = await requireBuffetSettingsScope();
    const payload = (await request.json().catch(() => null)) as UpdatePayload | null;
    const mode = payload?.mode === "set" ? "set" : payload?.mode === "per_person" ? "per_person" : null;
    const price = roundMoney(Number(payload?.price));
    if (!mode) return fail("invalid_buffet_mode", "Buffet mode must be per_person or set.", 422);
    if (price <= 0) return fail("invalid_buffet_price", "Buffet price must be greater than zero.", 422);

    const plan = DEFAULT_BUFFET_PRICE_PLANS.find((item) => item.mode === mode);
    if (!plan) return fail("buffet_plan_not_found", "Buffet plan was not found.", 404);

    const tenantId = scope.session.tenant_id;
    const branchId = scope.session.branch_id;
    const existing = await findProduct(tenantId, branchId, plan.name);
    if (existing.error) return fail("buffet_settings_query_failed", existing.error.message, 500);

    let product: BuffetProductRow | null = null;
    if (existing.data?.id) {
      const supabase = getSupabaseServiceClient();
      const updated = await supabase
        .from("products")
        .update({ price })
        .eq("id", existing.data.id)
        .eq("tenant_id", tenantId)
        .eq("branch_id", branchId)
        .select("id,name,price,is_active")
        .maybeSingle<BuffetProductRow>();
      if (updated.error || !updated.data?.id) {
        return fail("buffet_settings_update_failed", updated.error?.message ?? "Failed to update buffet price.", 500);
      }
      product = updated.data;
    } else {
      const inserted = await insertProduct({ tenantId, branchId, plan, price });
      if (!inserted.product?.id) {
        return fail("buffet_settings_create_failed", inserted.error?.message ?? "Failed to create buffet product.", 500);
      }
      product = inserted.product;
    }

    return ok({ plan: planFromProduct(plan, product), branch_id: branchId });
  } catch (error) {
    if (error instanceof FeatureGateError) return fail(error.code, error.message, error.status);
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    return fail("buffet_settings_update_failed", error instanceof Error ? error.message : "Unknown error", 500);
  }
}
