import { fail, ok } from "@/lib/http";
import {
  loadProductMediaMap,
  ProductMediaError,
  resolveProductMediaBranchForSession,
  resolveProductMediaQuota
} from "@/lib/product-media";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";

function mapError(error: unknown) {
  if (error instanceof ProductMediaError) return fail(error.code, error.message, error.status);
  if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
  console.error("[product-media] GET failed", error);
  return fail("product_media_failed", "Unable to load product images.", 500);
}

export async function GET(request: Request) {
  try {
    const scope = await requirePosSession();
    const url = new URL(request.url);
    const requestedBranchId = url.searchParams.get("branch_id");
    const resolved = await resolveProductMediaBranchForSession({
      scope,
      requestedBranchId,
      requireManage: Boolean(requestedBranchId && requestedBranchId !== scope.session.branch_id)
    });

    const productIds = String(url.searchParams.get("product_ids") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (productIds.length > 500) return fail("too_many_product_ids", "Too many product ids were requested.", 422);

    const includeQuota = url.searchParams.get("include_quota") === "1" || url.searchParams.get("include_quota") === "true";
    const assetMap = await loadProductMediaMap({
      tenantId: resolved.tenantId,
      branchId: resolved.branchId,
      productIds: productIds.length > 0 ? productIds : undefined
    });
    const quota = includeQuota ? await resolveProductMediaQuota(resolved.tenantId) : null;

    return ok({
      tenant_id: resolved.tenantId,
      branch_id: resolved.branchId,
      images: Object.fromEntries(assetMap.entries()),
      image_count: assetMap.size,
      quota,
      device_cache_enabled: Boolean(scope.session.device_id),
      source: "cpipos_primary_product_media"
    });
  } catch (error) {
    return mapError(error);
  }
}
