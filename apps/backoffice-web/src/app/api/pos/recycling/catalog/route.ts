import { fail, ok } from "@/lib/http";
import { FeatureGateError } from "@/lib/feature-gate";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";

type CatalogPayload = {
  id?: unknown;
  sku?: unknown;
  name?: unknown;
  category?: unknown;
  price_basis?: unknown;
  buy_price?: unknown;
  sell_price?: unknown;
  image_url?: unknown;
};

function readNonNegativePrice(raw: unknown): number | null {
  if (raw === "" || raw === null || raw === undefined) return null;
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 99999999 ||
      Math.abs(n * 100 - Math.round(n * 100)) > 0.00001) return null;
  return Math.round(n * 100) / 100;
}

export async function POST(request: Request) {
  try {
    const scope = await requirePosSession();
    const { tenant_id: tenantId, branch_id: branchId, role } = scope.session;
    if (role !== "owner" && role !== "manager") {
      return fail("recycling_catalog_forbidden", "Only owner and manager may change recycling material prices.", 403);
    }
    if (!await isAuthorizedRecyclingTenant(tenantId)) {
      return fail("recycling_not_authorized", "CUSTOM Recycling mode is not active for this tenant.", 403);
    }
    await requirePosApiFeature({ tenantId, branchId }, "stock_management");
    const body = await request.json().catch(() => null) as CatalogPayload | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail("invalid_payload", "Invalid payload.", 422);
    const sku = String(body.sku ?? "").trim();
    const name = String(body.name ?? "").trim();
    const category = String(body.category ?? "").trim();
    const priceBasis = body.price_basis === "piece" ? "piece" : body.price_basis === "kg" ? "kg" : null;
    const buyPrice = readNonNegativePrice(body.buy_price);
    const sellPrice = readNonNegativePrice(body.sell_price);
    if (!sku || sku.length > 90 || !name || name.length > 200 || !category || category.length > 120 ||
        !priceBasis || buyPrice === null || sellPrice === null) {
      return fail("invalid_material", "Name, category, SKU, price basis and both nonnegative prices are required.", 422);
    }
    const imageUrl = String(body.image_url ?? "").trim();
    if (imageUrl.length > 1000 || (imageUrl && !/^https:\/\/[^\s]+$/i.test(imageUrl))) {
      return fail("invalid_image_url", "Only an HTTPS image URL is allowed.", 422);
    }

    const db = getSupabaseServiceClient();
    const id = typeof body.id === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(body.id)
      ? body.id : null;
    let metadata: Record<string, unknown> = {};
    if (id) {
      const { data: existing, error } = await db.from("products")
        .select("id,sell_unit,metadata").eq("id", id).eq("tenant_id", tenantId)
        .eq("branch_id", branchId).is("deleted_at", null).maybeSingle();
      if (error) return fail("recycling_material_lookup_failed", "Unable to load material.", 500);
      if (!existing) return fail("recycling_material_missing", "Material does not belong to the current branch.", 404);
      metadata = existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
        ? existing.metadata as Record<string, unknown> : {};
      if (metadata.business_mode !== "recycling") {
        return fail("not_recycling_material", "Cannot change an unrelated POS product from Recycling catalog.", 403);
      }
      const previousBasis = metadata.recycling_price_basis === "piece" || existing.sell_unit === "piece" ? "piece" : "kg";
      // Unit changes need a controlled stock conversion/migration workflow.
      if (previousBasis !== priceBasis) return fail("price_basis_locked", "Material price basis cannot be changed after creation.", 409);
    }
    const patch = {
      sku, name, category,
      price: sellPrice,
      sell_unit: priceBasis,
      stock_deduction_mode: "unit_only" as const,
      metadata: {
        ...metadata,
        business_mode: "recycling",
        recycling_price_basis: priceBasis,
        recycling_buy_price: buyPrice,
        image_url: imageUrl || null
      }
    };
    const query = id
      ? db.from("products").update(patch).eq("id", id).eq("tenant_id", tenantId).eq("branch_id", branchId)
      : db.from("products").insert({ ...patch, tenant_id: tenantId, branch_id: branchId, is_active: true });
    const { data, error } = await query.select("id,sku,name,category,price,sell_unit,metadata").single();
    if (error) {
      if (error.code === "23505") return fail("duplicate_material_sku", "This barcode/SKU is already registered for this branch.", 409);
      return fail("recycling_catalog_save_failed", "Unable to save material.", 500);
    }
    return ok({ material: data });
  } catch (error) {
    if (error instanceof PosGuardError || error instanceof FeatureGateError) {
      return fail(error.code, error.message, error.status);
    }
    return fail("recycling_catalog_failed", "Unable to save recycling material.", 500);
  }
}
