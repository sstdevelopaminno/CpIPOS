import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
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
  const fallbackName = mode === "per_person" ? "บุฟเฟ่รายท่าน" : "บุฟเฟ่แบบชุด";
  const fallbackCode = mode === "per_person" ? "BUFFET-PER-PERSON" : "BUFFET-SET";
  const name = String(payload.name ?? "").trim() || fallbackName;
  const code = String(payload.code ?? "").trim() || fallbackCode;
  const price = roundMoney(Number(payload.price ?? 0));
  return {
    mode,
    name,
    code,
    price,
    category: "บุฟเฟ่"
  };
}

async function findExistingProduct(args: {
  tenantId: string;
  branchId: string;
  name: string;
}) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("products")
    .select("id,price,is_active")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("name", args.name)
    .limit(1)
    .maybeSingle<{ id: string; price: number | null; is_active: boolean | null }>();

  if (error) {
    return { product: null, error };
  }
  return { product: data ?? null, error: null };
}

async function activateExistingProduct(args: {
  tenantId: string;
  branchId: string;
  productId: string;
  price: number;
}) {
  const supabase = getSupabaseServiceClient();
  const { error } = await supabase
    .from("products")
    .update({ price: args.price, is_active: true })
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("id", args.productId);
  return error ?? null;
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
      .select("id")
      .maybeSingle<{ id: string }>();

    if (!error && data?.id) {
      return { productId: String(data.id), error: null };
    }

    lastError = error ?? null;
    if (isDuplicateError(error)) {
      const existing = await findExistingProduct({ tenantId: args.tenantId, branchId: args.branchId, name: args.name });
      if (existing.product?.id) return { productId: existing.product.id, error: null };
    }
    if (!isMissingColumnError(error)) {
      continue;
    }
  }

  return { productId: null, error: lastError };
}

export async function POST(request: Request) {
  try {
    const scope = await requirePosSession();
    requirePermission(scope, "sales:enter");
    await requireTenantFeature(scope.session.tenant_id, "core_pos_sales", scope.session.branch_id);

    const payload = (await request.json().catch(() => null)) as ResolveBuffetProductPayload | null;
    if (!payload) {
      return fail("invalid_payload", "Invalid buffet product payload.", 422);
    }

    const descriptor = buildBuffetProductDescriptor(payload);
    if (descriptor.price <= 0) {
      return fail("invalid_buffet_price", "Buffet price must be greater than zero.", 422);
    }

    const tenantId = scope.session.tenant_id;
    const branchId = scope.session.branch_id;
    const existing = await findExistingProduct({ tenantId, branchId, name: descriptor.name });
    if (existing.error) {
      return fail("buffet_product_query_failed", existing.error.message ?? "Failed to query buffet product.", 500);
    }

    if (existing.product?.id) {
      const updateError = await activateExistingProduct({
        tenantId,
        branchId,
        productId: existing.product.id,
        price: descriptor.price
      });
      if (updateError && !isMissingColumnError(updateError)) {
        return fail("buffet_product_update_failed", updateError.message ?? "Failed to update buffet product.", 500);
      }
      return ok({
        product_id: existing.product.id,
        name: descriptor.name,
        price: descriptor.price,
        reused: true
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

    if (!inserted.productId) {
      return fail(
        "buffet_product_create_failed",
        inserted.error?.message ?? "Failed to create buffet product.",
        500
      );
    }

    return ok({
      product_id: inserted.productId,
      name: descriptor.name,
      price: descriptor.price,
      reused: false
    });
  } catch (error) {
    if (error instanceof FeatureGateError) {
      return fail(error.code, error.message, error.status);
    }
    if (error instanceof PosGuardError) {
      return fail(error.code, error.message, error.status);
    }
    return fail("buffet_product_resolve_failed", error instanceof Error ? error.message : "Unknown error", 500);
  }
}
