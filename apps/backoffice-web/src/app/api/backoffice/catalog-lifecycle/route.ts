import { getAuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type ActionPayload = {
  action?: "soft_delete" | "restore";
  product_id?: string;
  reason?: string;
};

const SELECT_FIELDS =
  "id,sku,name,category,price,is_combo,is_active,deleted_at,deleted_by,delete_reason,restore_until,updated_at";

function canManage(role: string | null) {
  return role === "owner" || role === "manager";
}

export async function GET(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    await requirePosApiFeature(auth, "stock_management");
    const supabase = getSupabaseServiceClient();
    const { searchParams } = new URL(req.url);
    const view = searchParams.get("view") === "trash" ? "trash" : "active";
    const search = String(searchParams.get("search") ?? "").trim().slice(0, 80);

    let query = supabase
      .from("products")
      .select(SELECT_FIELDS)
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .order(view === "trash" ? "deleted_at" : "updated_at", { ascending: false })
      .limit(100);

    query = view === "trash" ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
    if (search) {
      const safe = search.replace(/[%_,()]/g, " ").trim();
      if (safe) query = query.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,category.ilike.%${safe}%`);
    }

    const { data, error } = await query;
    if (error) return fail("catalog_lifecycle_query_failed", error.message, 500);

    return ok({ view, items: data ?? [] });
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    return fail("catalog_lifecycle_unauthorized", error instanceof Error ? error.message : "Unauthorized", 401);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    await requirePosApiFeature(auth, "stock_management");
    if (!canManage(auth.branchRole)) return fail("forbidden_role", "Only manager or owner can manage catalog lifecycle.", 403);

    const body = (await req.json()) as ActionPayload;
    const productId = String(body.product_id ?? "").trim();
    if (!productId) return fail("product_id_required", "product_id is required.", 422);

    const supabase = getSupabaseServiceClient();
    const { data: product, error: readError } = await supabase
      .from("products")
      .select(SELECT_FIELDS)
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", productId)
      .maybeSingle();
    if (readError) return fail("catalog_lifecycle_read_failed", readError.message, 500);
    if (!product) return fail("product_not_found", "Product not found in this branch.", 404);

    if (body.action === "soft_delete") {
      if (product.deleted_at) return ok({ product, already_trashed: true });
      const deletedAt = new Date();
      const restoreUntil = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
      const reason = String(body.reason ?? "catalog_soft_delete").trim().slice(0, 240) || "catalog_soft_delete";

      const { data, error } = await supabase
        .from("products")
        .update({
          is_active: false,
          deleted_at: deletedAt.toISOString(),
          deleted_by: auth.userId,
          delete_reason: reason,
          restore_until: restoreUntil.toISOString(),
          updated_at: deletedAt.toISOString()
        })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("id", productId)
        .select(SELECT_FIELDS)
        .single();
      if (error) return fail("catalog_soft_delete_failed", error.message, 500);
      return ok({ product: data, trashed: true, hard_deleted: false });
    }

    if (body.action === "restore") {
      if (!product.deleted_at) return ok({ product, already_active: true });
      const restoreUntilMs = product.restore_until ? new Date(String(product.restore_until)).getTime() : Number.NaN;
      if (Number.isFinite(restoreUntilMs) && restoreUntilMs < Date.now()) {
        return fail("restore_window_expired", "The 30-day restore window has expired.", 409);
      }

      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("products")
        .update({
          is_active: true,
          deleted_at: null,
          deleted_by: null,
          delete_reason: null,
          restore_until: null,
          updated_at: now
        })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("id", productId)
        .select(SELECT_FIELDS)
        .single();
      if (error) return fail("catalog_restore_failed", error.message, 500);
      return ok({ product: data, restored: true });
    }

    return fail("invalid_action", "action must be soft_delete or restore.", 422);
  } catch (error) {
    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    return fail("catalog_lifecycle_failed", error instanceof Error ? error.message : "Unknown error", 500);
  }
}
