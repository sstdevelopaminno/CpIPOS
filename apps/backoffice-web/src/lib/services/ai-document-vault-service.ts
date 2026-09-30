import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";

const BUCKET = "cpipos-ai-documents";
const MAX_SOURCE_BYTES = 512 * 1024;

export type AiDocumentCategory = "general" | "sales" | "stock" | "cost" | "marketing" | "accounting" | "guide";

export type AiDocumentPolicy = {
  enabled: boolean;
  source: "package" | "tenant_custom" | "tenant_unlimited";
  retention_days: number | null;
  storage_limit_mb: number | null;
  max_files: number | null;
};

export type AiDocumentRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  user_id: string;
  room_id: string | null;
  title: string;
  category: AiDocumentCategory;
  object_path: string;
  mime_type: string;
  size_bytes: number;
  source_message_id: string | null;
  created_at: string;
  expires_at: string | null;
};

type PackagePolicyRow = {
  is_enabled: boolean;
  retention_days: number | null;
  storage_limit_mb: number | null;
  max_files: number | null;
};

type TenantOverrideRow = {
  policy_mode: "inherit" | "custom" | "unlimited";
  is_enabled_override: boolean | null;
  retention_days: number | null;
  storage_limit_mb: number | null;
  max_files: number | null;
};

function positiveOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function cleanTitle(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
  return text || "เอกสารจาก CpiPOS AI";
}

function cleanCategory(value: unknown): AiDocumentCategory {
  const text = String(value ?? "").trim();
  return (["general","sales","stock","cost","marketing","accounting","guide"] as const).includes(text as AiDocumentCategory)
    ? text as AiDocumentCategory
    : "general";
}

export async function loadAiDocumentPolicy(tenantId: string): Promise<AiDocumentPolicy> {
  const db = getSupabaseServiceClient();
  const tenantResult = await db.from("tenants").select("package_id").eq("id", tenantId).maybeSingle<{ package_id: string | null }>();
  if (tenantResult.error) throw new Error(`ai_document_tenant_failed:${tenantResult.error.message}`);
  const packageId = tenantResult.data?.package_id ?? null;

  const [packageResult, overrideResult] = await Promise.all([
    packageId
      ? db.from("pos_ai_document_package_policies")
          .select("is_enabled,retention_days,storage_limit_mb,max_files")
          .eq("package_id", packageId)
          .maybeSingle<PackagePolicyRow>()
      : Promise.resolve({ data: null, error: null }),
    db.from("pos_ai_document_tenant_overrides")
      .select("policy_mode,is_enabled_override,retention_days,storage_limit_mb,max_files")
      .eq("tenant_id", tenantId)
      .maybeSingle<TenantOverrideRow>()
  ]);
  if (packageResult.error) throw new Error(`ai_document_package_policy_failed:${packageResult.error.message}`);
  if (overrideResult.error) throw new Error(`ai_document_tenant_policy_failed:${overrideResult.error.message}`);

  const base: AiDocumentPolicy = {
    enabled: Boolean(packageResult.data?.is_enabled),
    source: "package",
    retention_days: positiveOrNull(packageResult.data?.retention_days),
    storage_limit_mb: positiveOrNull(packageResult.data?.storage_limit_mb),
    max_files: positiveOrNull(packageResult.data?.max_files)
  };

  const override = overrideResult.data;
  if (!override || override.policy_mode === "inherit") {
    if (override?.is_enabled_override !== null && override?.is_enabled_override !== undefined) {
      base.enabled = override.is_enabled_override;
      base.source = "tenant_custom";
    }
    return base;
  }

  if (override.policy_mode === "unlimited") {
    return {
      enabled: override.is_enabled_override !== false,
      source: "tenant_unlimited",
      retention_days: null,
      storage_limit_mb: null,
      max_files: null
    };
  }

  return {
    enabled: override.is_enabled_override ?? base.enabled,
    source: "tenant_custom",
    retention_days: positiveOrNull(override.retention_days) ?? base.retention_days,
    storage_limit_mb: positiveOrNull(override.storage_limit_mb) ?? base.storage_limit_mb,
    max_files: positiveOrNull(override.max_files) ?? base.max_files
  };
}

export async function pruneExpiredAiDocuments(tenantId: string, limit = 30) {
  const db = getSupabaseServiceClient();
  const { data, error } = await db.from("pos_ai_documents")
    .select("id,object_path")
    .eq("tenant_id", tenantId)
    .not("expires_at", "is", null)
    .lte("expires_at", new Date().toISOString())
    .limit(Math.max(1, Math.min(100, limit)))
    .returns<Array<{ id: string; object_path: string }>>();
  if (error) throw new Error(`ai_document_prune_scan_failed:${error.message}`);
  if (!data?.length) return 0;

  const paths = data.map((row) => row.object_path);
  const storage = await db.storage.from(BUCKET).remove(paths);
  if (storage.error) throw new Error(`ai_document_prune_storage_failed:${storage.error.message}`);

  const deleted = await db.from("pos_ai_documents").delete().in("id", data.map((row) => row.id)).eq("tenant_id", tenantId);
  if (deleted.error) throw new Error(`ai_document_prune_rows_failed:${deleted.error.message}`);
  return data.length;
}

export async function loadAiDocumentUsage(tenantId: string) {
  const db = getSupabaseServiceClient();
  const { data, error } = await db.from("pos_ai_documents")
    .select("size_bytes")
    .eq("tenant_id", tenantId)
    .returns<Array<{ size_bytes: number | null }>>();
  if (error) throw new Error(`ai_document_usage_failed:${error.message}`);
  const files = data?.length ?? 0;
  const bytes = (data ?? []).reduce((sum, row) => sum + Math.max(0, Number(row.size_bytes ?? 0)), 0);
  return { files, bytes, storage_mb: Number((bytes / (1024 * 1024)).toFixed(3)) };
}

export async function listAiDocuments(tenantId: string, branchId: string): Promise<AiDocumentRow[]> {
  const db = getSupabaseServiceClient();
  const { data, error } = await db.from("pos_ai_documents")
    .select("id,tenant_id,branch_id,user_id,room_id,title,category,object_path,mime_type,size_bytes,source_message_id,created_at,expires_at")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<AiDocumentRow[]>();
  if (error) throw new Error(`ai_document_list_failed:${error.message}`);
  return data ?? [];
}

export async function saveAiDocument(input: {
  tenantId: string;
  branchId: string;
  userId: string;
  roomId?: string | null;
  title?: string | null;
  category?: string | null;
  content: string;
  sourceMessageId?: string | null;
}) {
  const content = String(input.content ?? "").trim();
  if (!content) throw new Error("ai_document_content_required");
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_SOURCE_BYTES) throw new Error("ai_document_content_too_large");

  await pruneExpiredAiDocuments(input.tenantId, 20);
  const [policy, usage] = await Promise.all([
    loadAiDocumentPolicy(input.tenantId),
    loadAiDocumentUsage(input.tenantId)
  ]);
  if (!policy.enabled) throw new Error("ai_document_vault_disabled");
  if (policy.max_files !== null && usage.files >= policy.max_files) throw new Error("ai_document_file_limit_reached");
  if (policy.storage_limit_mb !== null && usage.bytes + bytes > policy.storage_limit_mb * 1024 * 1024) {
    throw new Error("ai_document_storage_limit_reached");
  }

  const db = getSupabaseServiceClient();
  const id = crypto.randomUUID();
  const objectPath = `${input.tenantId}/${input.branchId}/${id}.md`;
  const upload = await db.storage.from(BUCKET).upload(objectPath, Buffer.from(content, "utf8"), {
    contentType: "text/markdown; charset=utf-8",
    cacheControl: "3600",
    upsert: false
  });
  if (upload.error) throw new Error(`ai_document_upload_failed:${upload.error.message}`);

  const expiresAt = policy.retention_days
    ? new Date(Date.now() + policy.retention_days * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const inserted = await db.from("pos_ai_documents").insert({
    id,
    tenant_id: input.tenantId,
    branch_id: input.branchId,
    user_id: input.userId,
    room_id: input.roomId ?? null,
    title: cleanTitle(input.title),
    category: cleanCategory(input.category),
    object_path: objectPath,
    mime_type: "text/markdown",
    size_bytes: bytes,
    source_message_id: input.sourceMessageId ?? null,
    expires_at: expiresAt
  }).select("id,tenant_id,branch_id,user_id,room_id,title,category,object_path,mime_type,size_bytes,source_message_id,created_at,expires_at")
    .single<AiDocumentRow>();

  if (inserted.error) {
    await db.storage.from(BUCKET).remove([objectPath]);
    throw new Error(`ai_document_insert_failed:${inserted.error.message}`);
  }
  return { document: inserted.data, policy, usage_before: usage };
}

export async function getAiDocument(tenantId: string, branchId: string, documentId: string) {
  const db = getSupabaseServiceClient();
  const { data, error } = await db.from("pos_ai_documents")
    .select("id,tenant_id,branch_id,user_id,room_id,title,category,object_path,mime_type,size_bytes,source_message_id,created_at,expires_at")
    .eq("id", documentId)
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .maybeSingle<AiDocumentRow>();
  if (error) throw new Error(`ai_document_lookup_failed:${error.message}`);
  return data ?? null;
}

export async function readAiDocumentContent(tenantId: string, branchId: string, documentId: string) {
  const row = await getAiDocument(tenantId, branchId, documentId);
  if (!row) return null;
  const db = getSupabaseServiceClient();
  const downloaded = await db.storage.from(BUCKET).download(row.object_path);
  if (downloaded.error) throw new Error(`ai_document_download_failed:${downloaded.error.message}`);
  return { document: row, content: await downloaded.data.text() };
}

export async function createAiDocumentSignedUrl(tenantId: string, branchId: string, documentId: string) {
  const row = await getAiDocument(tenantId, branchId, documentId);
  if (!row) return null;
  const db = getSupabaseServiceClient();
  const signed = await db.storage.from(BUCKET).createSignedUrl(row.object_path, 60);
  if (signed.error) throw new Error(`ai_document_signed_url_failed:${signed.error.message}`);
  return { document: row, signed_url: signed.data.signedUrl };
}

export async function deleteAiDocument(tenantId: string, branchId: string, documentId: string) {
  const row = await getAiDocument(tenantId, branchId, documentId);
  if (!row) return false;
  const db = getSupabaseServiceClient();
  const storage = await db.storage.from(BUCKET).remove([row.object_path]);
  if (storage.error) throw new Error(`ai_document_delete_storage_failed:${storage.error.message}`);
  const deleted = await db.from("pos_ai_documents")
    .delete()
    .eq("id", row.id)
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId);
  if (deleted.error) throw new Error(`ai_document_delete_row_failed:${deleted.error.message}`);
  return true;
}

export async function deleteAiDocumentsForTenant(tenantId: string) {
  const db = getSupabaseServiceClient();
  const { data, error } = await db.from("pos_ai_documents")
    .select("id,object_path")
    .eq("tenant_id", tenantId)
    .limit(1000)
    .returns<Array<{ id: string; object_path: string }>>();
  if (error) throw new Error(`ai_document_tenant_delete_scan_failed:${error.message}`);
  if (!data?.length) return 0;
  const storage = await db.storage.from(BUCKET).remove(data.map((row) => row.object_path));
  if (storage.error) throw new Error(`ai_document_tenant_delete_storage_failed:${storage.error.message}`);
  const deleted = await db.from("pos_ai_documents").delete().eq("tenant_id", tenantId);
  if (deleted.error) throw new Error(`ai_document_tenant_delete_rows_failed:${deleted.error.message}`);
  return data.length;
}
