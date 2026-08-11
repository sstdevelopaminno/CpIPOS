import { createHash, randomUUID } from "node:crypto";
import { fail, ok } from "@/lib/http";
import {
  assertProductInMediaScope,
  loadProductMediaAssetRow,
  loadProductMediaMap,
  PRODUCT_MEDIA_BUCKET,
  PRODUCT_MEDIA_DISPLAY_MAX_BYTES,
  PRODUCT_MEDIA_THUMBNAIL_MAX_BYTES,
  ProductMediaError,
  recordProductMediaAudit,
  removeProductMediaObjects,
  resolveProductMediaBranchForSession,
  resolveProductMediaQuota
} from "@/lib/product-media";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function mapError(error: unknown) {
  if (error instanceof ProductMediaError) return fail(error.code, error.message, error.status);
  if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
  console.error("[product-media] mutation failed", error);
  return fail("product_media_mutation_failed", "Unable to update the product image.", 500);
}

function parseDimension(value: FormDataEntryValue | null, fallback: number) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 5000 ? parsed : fallback;
}

function isWebp(buffer: Buffer) {
  return buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
}

async function uploadObject(path: string, buffer: Buffer) {
  const primary = getPrimarySupabaseServiceClient();
  const { error } = await primary.storage.from(PRODUCT_MEDIA_BUCKET).upload(path, buffer, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false
  });
  if (error) throw new ProductMediaError("product_media_storage_upload_failed", "Unable to save the optimized product image.", 500);
}

export async function POST(request: Request, context: { params: Promise<{ productId: string }> }) {
  const uploadedPaths: string[] = [];
  try {
    const scope = await requirePosSession();
    const { productId } = await context.params;
    if (!UUID_RE.test(productId)) return fail("invalid_product_id", "Invalid product id.", 422);

    const form = await request.formData();
    const requestedBranchId = String(form.get("branch_id") ?? "").trim() || null;
    const resolved = await resolveProductMediaBranchForSession({ scope, requestedBranchId, requireManage: true });
    const product = await assertProductInMediaScope({ tenantId: resolved.tenantId, branchId: resolved.branchId, productId });

    const displayFile = form.get("display");
    const thumbnailFile = form.get("thumbnail");
    if (!(displayFile instanceof File) || !(thumbnailFile instanceof File)) {
      return fail("product_media_files_required", "Optimized display and thumbnail images are required.", 422);
    }
    if (displayFile.type !== "image/webp" || thumbnailFile.type !== "image/webp") {
      return fail("product_media_invalid_type", "Product images must be WebP after optimization.", 415);
    }
    if (displayFile.size <= 0 || displayFile.size > PRODUCT_MEDIA_DISPLAY_MAX_BYTES) {
      return fail("product_media_display_too_large", "Optimized display image is too large.", 413);
    }
    if (thumbnailFile.size <= 0 || thumbnailFile.size > PRODUCT_MEDIA_THUMBNAIL_MAX_BYTES) {
      return fail("product_media_thumbnail_too_large", "Optimized thumbnail image is too large.", 413);
    }

    const displayBuffer = Buffer.from(await displayFile.arrayBuffer());
    const thumbnailBuffer = Buffer.from(await thumbnailFile.arrayBuffer());
    if (!isWebp(displayBuffer) || !isWebp(thumbnailBuffer)) {
      return fail("product_media_invalid_signature", "Invalid WebP image payload.", 415);
    }

    const previous = await loadProductMediaAssetRow({ tenantId: resolved.tenantId, branchId: resolved.branchId, productId });
    const version = randomUUID();
    const prefix = `${resolved.tenantId}/${resolved.branchId}/${productId}`;
    const displayPath = `${prefix}/${version}-display.webp`;
    const thumbnailPath = `${prefix}/${version}-thumb.webp`;

    await uploadObject(displayPath, displayBuffer);
    uploadedPaths.push(displayPath);
    await uploadObject(thumbnailPath, thumbnailBuffer);
    uploadedPaths.push(thumbnailPath);

    const checksum = createHash("sha256").update(displayBuffer).update(thumbnailBuffer).digest("hex");
    const displayWidth = parseDimension(form.get("display_width"), 1200);
    const displayHeight = parseDimension(form.get("display_height"), 1200);
    const thumbnailWidth = parseDimension(form.get("thumbnail_width"), 400);
    const thumbnailHeight = parseDimension(form.get("thumbnail_height"), 400);
    const primary = getPrimarySupabaseServiceClient();
    const { data: rpcData, error: rpcError } = await primary.rpc("upsert_product_media_asset_tx", {
      p_tenant_id: resolved.tenantId,
      p_branch_id: resolved.branchId,
      p_product_id: productId,
      p_display_object_path: displayPath,
      p_thumbnail_object_path: thumbnailPath,
      p_display_bytes: displayBuffer.length,
      p_thumbnail_bytes: thumbnailBuffer.length,
      p_display_width: displayWidth,
      p_display_height: displayHeight,
      p_thumbnail_width: thumbnailWidth,
      p_thumbnail_height: thumbnailHeight,
      p_checksum_sha256: checksum,
      p_uploaded_by_user_id: resolved.userId,
      p_source_device_id: scope.session.device_id ?? null,
      p_metadata: {
        original_name: displayFile.name || null,
        product_name: product.name ?? null,
        optimized_by: "cpipos_canvas_webp_v1"
      }
    });

    if (rpcError) {
      await removeProductMediaObjects(uploadedPaths);
      uploadedPaths.length = 0;
      const message = String(rpcError.message ?? "");
      if (message.includes("PRODUCT_MEDIA_QUOTA_EXCEEDED")) {
        throw new ProductMediaError("product_media_quota_exceeded", "พื้นที่รูปสินค้าตามแพ็กเกจเต็มแล้ว กรุณาลบรูปเดิมหรือเพิ่มแพ็กเกจพื้นที่", 409);
      }
      if (message.includes("PRODUCT_MEDIA_FILE_TOO_LARGE")) {
        throw new ProductMediaError("product_media_file_too_large", "Optimized product image exceeds the server limit.", 413);
      }
      throw new ProductMediaError("product_media_database_failed", "Unable to register the product image.", 500);
    }

    const rpcRow = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as { asset_id?: string | null; quota_bytes?: number | null; used_bytes?: number | null } | null;
    if (previous) {
      await removeProductMediaObjects([previous.display_object_path, previous.thumbnail_object_path]);
    }

    const [assetMap, quota] = await Promise.all([
      loadProductMediaMap({ tenantId: resolved.tenantId, branchId: resolved.branchId, productIds: [productId] }),
      resolveProductMediaQuota(resolved.tenantId)
    ]);
    const asset = assetMap.get(productId) ?? null;

    await recordProductMediaAudit({
      scope,
      branchId: resolved.branchId,
      action: "product_media_upload",
      productId,
      assetId: rpcRow?.asset_id ?? asset?.asset_id ?? null,
      metadata: {
        display_bytes: displayBuffer.length,
        thumbnail_bytes: thumbnailBuffer.length,
        replaced_asset_id: previous?.id ?? null
      }
    });

    return ok({
      product_id: productId,
      asset,
      quota,
      transaction_usage: {
        quota_bytes: Number(rpcRow?.quota_bytes ?? quota.cloud_quota_bytes),
        used_bytes: Number(rpcRow?.used_bytes ?? quota.cloud_used_bytes)
      }
    }, previous ? 200 : 201);
  } catch (error) {
    if (uploadedPaths.length > 0) await removeProductMediaObjects(uploadedPaths);
    return mapError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ productId: string }> }) {
  try {
    const scope = await requirePosSession();
    const { productId } = await context.params;
    if (!UUID_RE.test(productId)) return fail("invalid_product_id", "Invalid product id.", 422);

    const url = new URL(request.url);
    const requestedBranchId = url.searchParams.get("branch_id");
    const resolved = await resolveProductMediaBranchForSession({ scope, requestedBranchId, requireManage: true });
    await assertProductInMediaScope({ tenantId: resolved.tenantId, branchId: resolved.branchId, productId });

    const previous = await loadProductMediaAssetRow({ tenantId: resolved.tenantId, branchId: resolved.branchId, productId });
    if (!previous) {
      const quota = await resolveProductMediaQuota(resolved.tenantId);
      return ok({ product_id: productId, deleted: false, quota });
    }

    const primary = getPrimarySupabaseServiceClient();
    const { error } = await primary
      .from("product_media_assets")
      .delete()
      .eq("tenant_id", resolved.tenantId)
      .eq("branch_id", resolved.branchId)
      .eq("product_id", productId);
    if (error) throw new ProductMediaError("product_media_delete_failed", "Unable to delete the product image.", 500);

    await removeProductMediaObjects([previous.display_object_path, previous.thumbnail_object_path]);
    await recordProductMediaAudit({
      scope,
      branchId: resolved.branchId,
      action: "product_media_delete",
      productId,
      assetId: previous.id,
      metadata: { released_bytes: previous.display_bytes + previous.thumbnail_bytes }
    });

    const quota = await resolveProductMediaQuota(resolved.tenantId);
    return ok({ product_id: productId, deleted: true, quota });
  } catch (error) {
    return mapError(error);
  }
}
