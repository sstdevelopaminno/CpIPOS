import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { loadAiQuotaStatus } from "@/lib/services/ai-usage-service";

const BUCKET = "cpipos-ai-documents";

export type AiDocumentScope = {
  tenantId: string;
  branchId: string;
  userId: string;
};

export type AiDocumentRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  user_id: string;
  room_id: string | null;
  title: string;
  file_name: string;
  format: "markdown" | "csv" | "html" | "json" | "pdf";
  mime_type: string;
  object_path: string;
  size_bytes: number;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};

function extensionFor(format: AiDocumentRow["format"]) {
  if (format === "csv") return "csv";
  if (format === "json") return "json";
  if (format === "html") return "html";
  if (format === "pdf") return "pdf";
  return "md";
}

function mimeFor(format: AiDocumentRow["format"]) {
  if (format === "csv") return "text/csv";
  if (format === "json") return "application/json";
  if (format === "html") return "text/html";
  if (format === "pdf") return "application/pdf";
  return "text/markdown";
}

function cleanTitle(value: unknown) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 180);
  return text || "เอกสารจาก CpiPOS AI";
}

function cleanFileName(title: string, ext: string) {
  const base = title
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "cpipos-ai-document";
  return `${base}.${ext}`;
}

async function usageForTenant(tenantId: string) {
  const db = getSupabaseServiceClient();
  const result = await db.rpc("pos_ai_document_usage", { p_tenant_id: tenantId });
  if (result.error) throw new Error(`ai_document_usage_failed:${result.error.message}`);
  const row = ((result.data ?? []) as Array<{ document_count?: number | string; total_bytes?: number | string }>)[0];
  return {
    count: Number(row?.document_count ?? 0),
    bytes: Number(row?.total_bytes ?? 0)
  };
}

export async function pruneExpiredAiDocuments(scope: AiDocumentScope) {
  const db = getSupabaseServiceClient();
  const now = new Date().toISOString();
  const result = await db
    .from("pos_ai_documents")
    .select("id,object_path")
    .eq("tenant_id", scope.tenantId)
    .lt("expires_at", now)
    .limit(50);
  if (result.error) throw new Error(`ai_document_retention_scan_failed:${result.error.message}`);
  const rows = result.data ?? [];
  if (!rows.length) return 0;

  const paths = rows.map((row) => String(row.object_path)).filter(Boolean);
  if (paths.length) {
    const removed = await db.storage.from(BUCKET).remove(paths);
    if (removed.error) throw new Error(`ai_document_storage_delete_failed:${removed.error.message}`);
  }
  const deleted = await db.from("pos_ai_documents").delete().in("id", rows.map((row) => row.id));
  if (deleted.error) throw new Error(`ai_document_metadata_delete_failed:${deleted.error.message}`);
  return rows.length;
}

export async function listAiDocuments(scope: AiDocumentScope) {
  await pruneExpiredAiDocuments(scope);
  const db = getSupabaseServiceClient();
  const [docs, usage, quota] = await Promise.all([
    db.from("pos_ai_documents")
      .select("id,tenant_id,branch_id,user_id,room_id,title,file_name,format,mime_type,object_path,size_bytes,source_message_id,created_at,updated_at,expires_at")
      .eq("tenant_id", scope.tenantId)
      .eq("branch_id", scope.branchId)
      .eq("user_id", scope.userId)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<AiDocumentRow[]>(),
    usageForTenant(scope.tenantId),
    loadAiQuotaStatus(scope.tenantId)
  ]);
  if (docs.error) throw new Error(`ai_document_list_failed:${docs.error.message}`);
  return {
    documents: docs.data ?? [],
    usage,
    policy: quota.documents
  };
}

export async function createAiDocument(scope: AiDocumentScope, input: {
  title?: string;
  content: string;
  format?: "markdown" | "csv" | "json";
  roomId?: string | null;
  sourceMessageId?: string | null;
}) {
  const format = input.format === "csv" ? "csv" : input.format === "json" ? "json" : "markdown";
  const contentText = String(input.content ?? "").trim();
  if (!contentText) throw new Error("ai_document_content_required");
  const quota = await loadAiQuotaStatus(scope.tenantId);
  const storageLimitMb = quota.documents.storage_limit_mb;
  const maxFileMb = quota.documents.max_file_mb ?? 5;
  if (storageLimitMb === null) throw new Error("ai_document_policy_not_configured");

  await pruneExpiredAiDocuments(scope);
  const bytes = Buffer.byteLength(contentText, "utf8");
  const maxBytes = maxFileMb * 1024 * 1024;
  if (bytes > maxBytes) throw new Error("ai_document_file_too_large");

  const usage = await usageForTenant(scope.tenantId);
  const storageLimitBytes = storageLimitMb * 1024 * 1024;
  if (usage.bytes + bytes > storageLimitBytes) throw new Error("ai_document_storage_quota_exhausted");

  const db = getSupabaseServiceClient();
  const id = crypto.randomUUID();
  const title = cleanTitle(input.title);
  const ext = extensionFor(format);
  const fileName = cleanFileName(title, ext);
  const objectPath = `${scope.tenantId}/${scope.branchId}/${scope.userId}/${id}.${ext}`;
  const mimeType = mimeFor(format);
  const expiresAt = quota.documents.retention_days
    ? new Date(Date.now() + quota.documents.retention_days * 86400000).toISOString()
    : null;

  const uploaded = await db.storage.from(BUCKET).upload(objectPath, Buffer.from(contentText, "utf8"), {
    contentType: mimeType,
    upsert: false,
    cacheControl: "3600"
  });
  if (uploaded.error) throw new Error(`ai_document_upload_failed:${uploaded.error.message}`);

  const inserted = await db.from("pos_ai_documents").insert({
    id,
    tenant_id: scope.tenantId,
    branch_id: scope.branchId,
    user_id: scope.userId,
    room_id: input.roomId || null,
    title,
    file_name: fileName,
    format,
    mime_type: mimeType,
    object_path: objectPath,
    size_bytes: bytes,
    source_message_id: input.sourceMessageId || null,
    expires_at: expiresAt
  }).select("id,tenant_id,branch_id,user_id,room_id,title,file_name,format,mime_type,object_path,size_bytes,source_message_id,created_at,updated_at,expires_at")
    .single<AiDocumentRow>();

  if (inserted.error) {
    await db.storage.from(BUCKET).remove([objectPath]);
    throw new Error(`ai_document_metadata_write_failed:${inserted.error.message}`);
  }
  return inserted.data;
}

export async function getAiDocument(scope: AiDocumentScope, documentId: string) {
  const db = getSupabaseServiceClient();
  const result = await db.from("pos_ai_documents")
    .select("id,tenant_id,branch_id,user_id,room_id,title,file_name,format,mime_type,object_path,size_bytes,source_message_id,created_at,updated_at,expires_at")
    .eq("id", documentId)
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("user_id", scope.userId)
    .maybeSingle<AiDocumentRow>();
  if (result.error) throw new Error(`ai_document_lookup_failed:${result.error.message}`);
  return result.data ?? null;
}

export async function getAiDocumentText(scope: AiDocumentScope, documentId: string) {
  const document = await getAiDocument(scope, documentId);
  if (!document) return null;
  const db = getSupabaseServiceClient();
  const downloaded = await db.storage.from(BUCKET).download(document.object_path);
  if (downloaded.error) throw new Error(`ai_document_download_failed:${downloaded.error.message}`);
  return {
    document,
    content: await downloaded.data.text()
  };
}

export async function createAiDocumentSignedUrl(scope: AiDocumentScope, documentId: string) {
  const document = await getAiDocument(scope, documentId);
  if (!document) return null;
  const result = await getSupabaseServiceClient().storage.from(BUCKET).createSignedUrl(document.object_path, 300, {
    download: document.file_name
  });
  if (result.error) throw new Error(`ai_document_signed_url_failed:${result.error.message}`);
  return { document, signed_url: result.data.signedUrl };
}

export async function deleteAiDocument(scope: AiDocumentScope, documentId: string) {
  const document = await getAiDocument(scope, documentId);
  if (!document) return;
  const db = getSupabaseServiceClient();
  const removed = await db.storage.from(BUCKET).remove([document.object_path]);
  if (removed.error) throw new Error(`ai_document_storage_delete_failed:${removed.error.message}`);
  const deleted = await db.from("pos_ai_documents")
    .delete()
    .eq("id", document.id)
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("user_id", scope.userId);
  if (deleted.error) throw new Error(`ai_document_metadata_delete_failed:${deleted.error.message}`);
}
