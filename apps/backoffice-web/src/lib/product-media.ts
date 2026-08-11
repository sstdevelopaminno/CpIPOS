import "server-only";

import type { PosSessionScope } from "@/lib/pos-session-guard";
import { getPrimarySupabaseServiceClient, getSupabaseServiceClient } from "@/lib/supabase-admin";

export const PRODUCT_MEDIA_BUCKET = "product-media";
export const PRODUCT_MEDIA_DISPLAY_MAX_BYTES = 1_572_864;
export const PRODUCT_MEDIA_THUMBNAIL_MAX_BYTES = 524_288;
export const PRODUCT_MEDIA_SOURCE_MAX_BYTES = 20 * 1024 * 1024;

const DEFAULT_CLOUD_QUOTA_MB = 100;
const DEFAULT_DEVICE_CACHE_MB = 256;
const MAX_CONFIGURED_QUOTA_MB = 102_400;

export type ProductMediaAssetRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  product_id: string;
  display_object_path: string;
  thumbnail_object_path: string;
  display_bytes: number;
  thumbnail_bytes: number;
  display_width: number;
  display_height: number;
  thumbnail_width: number;
  thumbnail_height: number;
  content_type: string;
  checksum_sha256: string;
  uploaded_by_user_id: string;
  source_device_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type ProductMediaPublicAsset = {
  asset_id: string;
  product_id: string;
  image_url: string;
  thumbnail_url: string;
  display_bytes: number;
  thumbnail_bytes: number;
  display_width: number;
  display_height: number;
  thumbnail_width: number;
  thumbnail_height: number;
  updated_at: string;
};

export type ProductMediaQuota = {
  package_id: string | null;
  package_code: string | null;
  package_name: string | null;
  cloud_quota_bytes: number;
  device_cache_quota_bytes: number;
  cloud_used_bytes: number;
  cloud_remaining_bytes: number;
};

export class ProductMediaError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "ProductMediaError";
    this.code = code;
    this.status = status;
  }
}

function readQuotaMb(metadata: unknown, key: string): number | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = Number((metadata as Record<string, unknown>)[key]);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.max(1, Math.min(MAX_CONFIGURED_QUOTA_MB, value));
}

function mibToBytes(value: number) {
  return Math.floor(value * 1024 * 1024);
}

function publicObjectUrl(path: string) {
  return getPrimarySupabaseServiceClient().storage.from(PRODUCT_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function resolveProductMediaBranchForSession(args: {
  scope: PosSessionScope;
  requestedBranchId?: string | null;
  requireManage?: boolean;
}) {
  const { scope } = args;
  const requested = String(args.requestedBranchId ?? "").trim();
  const currentBranchId = scope.session.branch_id;
  const tenantId = scope.session.tenant_id;
  const userId = scope.session.user_id;
  const requireManage = args.requireManage === true;
  let branchId = requested || currentBranchId;
  let role = String(scope.session.role ?? "staff");

  if (branchId !== currentBranchId) {
    const primary = getPrimarySupabaseServiceClient();
    const [{ data: membership, error: membershipError }, { data: branch, error: branchError }] = await Promise.all([
      primary
        .from("user_branch_roles")
        .select("role")
        .eq("tenant_id", tenantId)
        .eq("user_id", userId)
        .eq("branch_id", branchId)
        .limit(1)
        .maybeSingle<{ role: string | null }>(),
      primary
        .from("branches")
        .select("id,is_active")
        .eq("tenant_id", tenantId)
        .eq("id", branchId)
        .maybeSingle<{ id: string; is_active: boolean | null }>()
    ]);

    if (membershipError || branchError) {
      throw new ProductMediaError("product_media_branch_scope_failed", "Unable to verify branch access.", 500);
    }
    if (!membership || !branch || branch.is_active === false) {
      throw new ProductMediaError("forbidden_branch_scope", "You do not have access to this branch.", 403);
    }
    role = String(membership.role ?? "staff");
  }

  if (requireManage && role !== "owner" && role !== "manager") {
    throw new ProductMediaError("product_media_manage_forbidden", "Owner or manager role is required to manage product images.", 403);
  }

  return { tenantId, branchId, userId, role };
}

export async function assertProductInMediaScope(args: {
  tenantId: string;
  branchId: string;
  productId: string;
}) {
  const productId = String(args.productId ?? "").trim();
  if (!productId) throw new ProductMediaError("invalid_product_id", "Product id is required.", 422);

  const routed = getSupabaseServiceClient();
  const { data, error } = await routed
    .from("products")
    .select("id,name,is_active")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("id", productId)
    .maybeSingle<{ id: string; name: string | null; is_active: boolean | null }>();

  if (error) throw new ProductMediaError("product_media_product_query_failed", "Unable to verify product.", 500);
  if (!data) throw new ProductMediaError("product_not_found", "Product was not found in this branch.", 404);
  return data;
}

export async function loadProductMediaAssetRow(args: {
  tenantId: string;
  branchId: string;
  productId: string;
}) {
  const primary = getPrimarySupabaseServiceClient();
  const { data, error } = await primary
    .from("product_media_assets")
    .select("id,tenant_id,branch_id,product_id,display_object_path,thumbnail_object_path,display_bytes,thumbnail_bytes,display_width,display_height,thumbnail_width,thumbnail_height,content_type,checksum_sha256,uploaded_by_user_id,source_device_id,metadata,created_at,updated_at")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId)
    .eq("product_id", args.productId)
    .maybeSingle<ProductMediaAssetRow>();
  if (error) throw new ProductMediaError("product_media_query_failed", "Unable to load product image.", 500);
  return data ?? null;
}

export async function loadProductMediaMap(args: {
  tenantId: string;
  branchId: string;
  productIds?: readonly string[];
}) {
  const primary = getPrimarySupabaseServiceClient();
  const ids = Array.from(new Set((args.productIds ?? []).map((value) => String(value).trim()).filter(Boolean)));
  if (ids.length > 500) throw new ProductMediaError("too_many_product_ids", "Too many product ids were requested.", 422);

  let query = primary
    .from("product_media_assets")
    .select("id,product_id,display_object_path,thumbnail_object_path,display_bytes,thumbnail_bytes,display_width,display_height,thumbnail_width,thumbnail_height,updated_at")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId);
  if (ids.length > 0) query = query.in("product_id", ids);

  const { data, error } = await query.order("updated_at", { ascending: false });
  if (error) throw new ProductMediaError("product_media_query_failed", "Unable to load product images.", 500);

  const map = new Map<string, ProductMediaPublicAsset>();
  for (const row of data ?? []) {
    const productId = String(row.product_id);
    if (map.has(productId)) continue;
    map.set(productId, {
      asset_id: String(row.id),
      product_id: productId,
      image_url: publicObjectUrl(String(row.display_object_path)),
      thumbnail_url: publicObjectUrl(String(row.thumbnail_object_path)),
      display_bytes: Number(row.display_bytes ?? 0),
      thumbnail_bytes: Number(row.thumbnail_bytes ?? 0),
      display_width: Number(row.display_width ?? 0),
      display_height: Number(row.display_height ?? 0),
      thumbnail_width: Number(row.thumbnail_width ?? 0),
      thumbnail_height: Number(row.thumbnail_height ?? 0),
      updated_at: String(row.updated_at ?? "")
    });
  }
  return map;
}

export async function getProductMediaUsageBytes(tenantId: string) {
  const primary = getPrimarySupabaseServiceClient();
  const { data, error } = await primary
    .from("product_media_assets")
    .select("display_bytes,thumbnail_bytes")
    .eq("tenant_id", tenantId);
  if (error) throw new ProductMediaError("product_media_usage_failed", "Unable to calculate media usage.", 500);
  return (data ?? []).reduce((sum, row) => sum + Number(row.display_bytes ?? 0) + Number(row.thumbnail_bytes ?? 0), 0);
}

export async function resolveProductMediaQuota(tenantId: string): Promise<ProductMediaQuota> {
  const primary = getPrimarySupabaseServiceClient();
  const [{ data: contract, error: contractError }, { data: tenant, error: tenantError }, cloudUsedBytes] = await Promise.all([
    primary
      .from("tenant_subscription_contracts")
      .select("package_id,metadata,status,started_at")
      .eq("tenant_id", tenantId)
      .in("status", ["active", "trial", "grace"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ package_id: string | null; metadata: Record<string, unknown> | null; status: string; started_at: string }>(),
    primary
      .from("tenants")
      .select("package_id")
      .eq("id", tenantId)
      .maybeSingle<{ package_id: string | null }>(),
    getProductMediaUsageBytes(tenantId)
  ]);

  if (contractError || tenantError) {
    throw new ProductMediaError("product_media_quota_lookup_failed", "Unable to resolve media package quota.", 500);
  }

  const packageId = contract?.package_id ?? tenant?.package_id ?? null;
  let packageCode: string | null = null;
  let packageName: string | null = null;
  let packageMetadata: Record<string, unknown> | null = null;

  if (packageId) {
    const { data: packageRow, error: packageError } = await primary
      .from("subscription_packages")
      .select("code,name,metadata")
      .eq("id", packageId)
      .maybeSingle<{ code: string | null; name: string | null; metadata: Record<string, unknown> | null }>();
    if (packageError) {
      throw new ProductMediaError("product_media_quota_lookup_failed", "Unable to resolve media package quota.", 500);
    }
    packageCode = packageRow?.code ?? null;
    packageName = packageRow?.name ?? null;
    packageMetadata = packageRow?.metadata ?? null;
  }

  const cloudQuotaMb =
    readQuotaMb(contract?.metadata, "product_media_cloud_quota_mb") ??
    readQuotaMb(packageMetadata, "product_media_cloud_quota_mb") ??
    DEFAULT_CLOUD_QUOTA_MB;
  const deviceCacheMb =
    readQuotaMb(contract?.metadata, "product_media_device_cache_mb") ??
    readQuotaMb(packageMetadata, "product_media_device_cache_mb") ??
    DEFAULT_DEVICE_CACHE_MB;

  const cloudQuotaBytes = mibToBytes(cloudQuotaMb);
  return {
    package_id: packageId,
    package_code: packageCode,
    package_name: packageName,
    cloud_quota_bytes: cloudQuotaBytes,
    device_cache_quota_bytes: mibToBytes(deviceCacheMb),
    cloud_used_bytes: cloudUsedBytes,
    cloud_remaining_bytes: Math.max(0, cloudQuotaBytes - cloudUsedBytes)
  };
}

export async function removeProductMediaObjects(paths: readonly (string | null | undefined)[]) {
  const clean = Array.from(new Set(paths.map((value) => String(value ?? "").trim()).filter(Boolean)));
  if (clean.length === 0) return;
  const { error } = await getPrimarySupabaseServiceClient().storage.from(PRODUCT_MEDIA_BUCKET).remove(clean);
  if (error) console.error("[product-media] object cleanup failed", { message: error.message, count: clean.length });
}

export async function recordProductMediaAudit(args: {
  scope: PosSessionScope;
  branchId: string;
  action: "product_media_upload" | "product_media_delete";
  productId: string;
  assetId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    const primary = getPrimarySupabaseServiceClient();
    await primary.from("audit_logs").insert({
      tenant_id: args.scope.session.tenant_id,
      branch_id: args.branchId,
      actor_user_id: args.scope.session.user_id,
      actor_role: args.scope.session.role,
      action: args.action,
      target_table: "product_media_assets",
      target_id: args.assetId ?? null,
      metadata: { product_id: args.productId, ...(args.metadata ?? {}) },
      user_id: args.scope.session.user_id,
      role: args.scope.session.role,
      module: "product_media",
      entity_type: "product",
      entity_id: args.productId,
      device_code: args.scope.session.device_code ?? null,
      pos_session_id: args.scope.session.id
    });
  } catch (error) {
    console.error("[product-media] audit write failed", error);
  }
}
