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
const ACCEPTED_OPTIMIZED_MEDIA_TYPES = new Set(["image/webp", "image/jpeg", "image/png"]);
const MEDIA_EXTENSION_BY_TYPE: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png"
};

type OptimizedMedia = {
  buffer: Buffer;
  contentType: "image/webp" | "image/jpeg" | "image/png";
  extension: "webp" | "jpg" | "png";
};

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

function isJpeg(buffer: Buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function isPng(buffer: Buffer) {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function detectMediaContentType(buffer: Buffer): OptimizedMedia["contentType"] | null {
  if (isWebp(buffer)) return "image/webp";
  if (isJpeg(buffer)) return "image/jpeg";
  if (isPng(buffer)) return "image/png";
  return null;
}

async function readOptimizedMedia(file: File, label: "display" | "thumbnail"): Promise<OptimizedMedia | { error: ReturnType<typeof fail> }> {
  const declaredType = String(file.type ?? "").toLowerCase();
  if (!ACCEPTED_OPTIMIZED_MEDIA_TYPES.has(declaredType)) {
    return { error: fail("product_media_invalid_type", "Product images must be optimized as WebP, JPEG, or PNG.", 415) };
  }

  const maxBytes = label === "display" ? PRODUCT_MEDIA_DISPLAY_MAX_BYTES : PRODUCT_MEDIA_THUMBNAIL_MAX_BYTES;
  const tooLargeCode = label === "display" ? "product_media_display_too_large" : "product_media_thumbnail_too_large";
  const tooLargeMessage = label === "display" ? "Optimized display image is too large." : "Optimized thumbnail image is too large.";
  if (file.size <= 0 || file.size > maxBytes) {
    return { error: fail(tooLargeCode, tooLargeMessage, 413) };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const detectedType = detectMediaContentType(buffer);
  if (!detectedType) {
    return { error: fail("product_media_invalid_signature", "Invalid optimized image payload.", 415) };
  }

  if (declaredType !== detectedType) {
    return { error: fail("product_media_type_mismatch", "Optimized image content does not match its declared type.", 415) };
  }

  return {
    buffer,
    contentType: detectedType,
    extension: MEDIA_EXTENSION_BY_TYPE[detectedType] as OptimizedMedia["extension"]
  };
}

async function uploadObject(path: string, buffer: Buffer, contentType: OptimizedMedia["contentType"]) {
  const primary = getPrimarySupabaseServiceClient();
  const { error } = await primary.storage.from(PRODUCT_MEDIA_BUCKET).upload(path, buffer, {
    contentType,
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

    const displayMedia = await readOptimizedMedia(displayFile, "display");
    if ("error" in displayMedia) return displayMedia.error;
    const thumbnailMedia = await readOptimizedMedia(thumbnailFile, "thumbnail");
    if ("error" in thumbnailMedia) return thumbnailMedia.error;

    const previous = await loadProductMediaAssetRow({ tenantId: resolved.tenantId, branchId: resolved.branchId, productId });
    const version = randomUUID();
    const prefix = `${resolved.tenantId}/${resolved.branchId}/${productId}`;
    const displayPath = `${prefix}/${version}-display.${displayMedia.extension}`;
    const thumbnailPath = `${prefix}/${version}-thumb.${thumbnailMedia.extension}`;

    await uploadObject(displayPath, displayMedia.buffer, displayMedia.contentType);
    uploadedPaths.push(displayPath);
    await uploadObject(thumbnailPath, thumbnailMedia.buffer, thumbnailMedia.contentType);
    uploadedPaths.push(thumbnailPath);

    const checksum = createHash("sha256").update(displayMedia.buffer).update(thumbnailMedia.buffer).digest("hex");
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
      p_display_bytes: displayMedia.buffer.length,
      p_thumbnail_bytes: thumbnailMedia.buffer.length,
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
        optimized_by: displayMedia.contentType === "image/webp" && thumbnailMedia.contentType === "image/webp" ? "cpipos_canvas_webp_v1" : "cpipos_canvas_fallback_v2",
        display_content_type: displayMedia.contentType,
        thumbnail_content_type: thumbnailMedia.contentType
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
        display_bytes: displayMedia.buffer.length,
        thumbnail_bytes: thumbnailMedia.buffer.length,
        display_content_type: displayMedia.contentType,
        thumbnail_content_type: thumbnailMedia.contentType,
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
