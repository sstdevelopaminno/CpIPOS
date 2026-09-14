import { getAuthContext } from "@/lib/auth-context";
import { fail } from "@/lib/http";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

import { POST as upsertBundle } from "../route";

type PopupBundlePayload = {
  action?: "upsert_bundle";
  id?: string;
  sku?: string;
  name?: string;
  category?: string;
  price?: number;
  items?: Array<{ product_id?: string; qty?: number }>;
};

function canManage(role: string | null) {
  return role === "owner" || role === "manager";
}

function delegateRequest(req: Request, body: PopupBundlePayload) {
  const headers = new Headers(req.headers);
  headers.delete("content-length");
  return new Request(req.url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function hasInvalidBundleQuantity(items: PopupBundlePayload["items"]) {
  if (!Array.isArray(items)) return false;
  return items.some((item) => {
    const qty = Number(item?.qty);
    return !Number.isFinite(qty) || !Number.isInteger(qty) || qty < 1;
  });
}

/**
 * Adapter used by the POS stock Add/Edit popup.
 *
 * The canonical bundle writer intentionally only updates rows already marked as
 * is_combo=true. The stock popup, however, must be able to turn an existing
 * ordinary sale product into a bundle. We do the smallest possible pre-flight
 * mutation here, delegate all composition/recipe writes to the canonical bundle
 * route, and revert the flag if that write fails.
 */
export async function POST(req: Request) {
  let convertedProductId = "";

  try {
    const auth = await getAuthContext({ requireBranchScope: true });
    await requirePosApiFeature(auth, "bundle_products");
    if (!canManage(auth.branchRole)) {
      return fail("forbidden_role", "Only manager or owner can manage bundle products.", 403);
    }

    const body = (await req.json()) as PopupBundlePayload;
    if (body.action !== "upsert_bundle") {
      return fail("invalid_action", "action must be upsert_bundle.", 422);
    }
    if (hasInvalidBundleQuantity(body.items)) {
      return fail(
        "invalid_bundle_item_quantity",
        "Bundle item quantity must be a whole number greater than or equal to 1.",
        422,
      );
    }

    const productId = String(body.id ?? "").trim();
    if (!productId) {
      return upsertBundle(delegateRequest(req, body));
    }

    const supabase = getSupabaseServiceClient();
    const { data: product, error } = await supabase
      .from("products")
      .select("id,is_combo,is_active,deleted_at")
      .eq("tenant_id", auth.tenantId!)
      .eq("branch_id", auth.branchId!)
      .eq("id", productId)
      .maybeSingle();

    if (error) return fail("bundle_popup_product_query_failed", error.message, 500);
    if (!product || product.deleted_at || product.is_active !== true) {
      return fail("bundle_popup_product_not_found", "Product is not active in this branch.", 404);
    }

    if (product.is_combo !== true) {
      const { error: convertError } = await supabase
        .from("products")
        .update({ is_combo: true, updated_at: new Date().toISOString() })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("id", productId)
        .eq("is_combo", false);

      if (convertError) return fail("bundle_popup_convert_failed", convertError.message, 500);
      convertedProductId = productId;
    }

    const response = await upsertBundle(delegateRequest(req, body));
    if (!response.ok && convertedProductId) {
      await supabase
        .from("products")
        .update({ is_combo: false, updated_at: new Date().toISOString() })
        .eq("tenant_id", auth.tenantId!)
        .eq("branch_id", auth.branchId!)
        .eq("id", convertedProductId);
    }
    return response;
  } catch (error) {
    if (convertedProductId) {
      try {
        const auth = await getAuthContext({ requireBranchScope: true });
        const supabase = getSupabaseServiceClient();
        await supabase
          .from("products")
          .update({ is_combo: false, updated_at: new Date().toISOString() })
          .eq("tenant_id", auth.tenantId!)
          .eq("branch_id", auth.branchId!)
          .eq("id", convertedProductId);
      } catch {
        // Best-effort rollback; the canonical writer also restores its own snapshot.
      }
    }

    const featureError = featureGateFail(error);
    if (featureError) return featureError;
    return fail(
      "bundle_popup_save_failed",
      error instanceof Error ? error.message : "Unable to save bundle from stock popup.",
      500,
    );
  }
}
