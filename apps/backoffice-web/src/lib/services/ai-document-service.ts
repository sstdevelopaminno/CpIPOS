import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { loadAiQuotaStatus } from "@/lib/services/ai-usage-service";

export type AiDocumentScope = {
  tenantId: string;
  branchId: string;
  userId: string;
};

export type AiDocumentRow = {
  id: string;
  title: string;
  document_type: string;
  file_name: string;
  mime_type: string;
  storage_path: string;
  size_bytes: number;
  source_room_id: string | null;
  created_at: string;
  expires_at: string | null;
};

const BUCKET = "cpipos-ai-documents";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char] ?? char));
}

function htmlDocument(title: string, content: string) {
  const escaped = escapeHtml(content)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/^[-•]\s+(.+)$/gm, "<li>$1</li>")
    .replace(/\n/g, "<br/>");
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font-family:"Noto Sans Thai","Leelawadee UI","Segoe UI",sans-serif;margin:40px;color:#172033;line-height:1.75}h1{font-size:24px}main{max-width:900px;margin:auto}.meta{color:#64748b;font-size:12px;margin-bottom:24px}.content{font-size:15px;white-space:normal}li{margin:4px 0}@media print{body{margin:18mm}.meta{display:none}}</style></head><body><main><h1>${escapeHtml(title)}</h1><div class="meta">สร้างจาก CpiPOS AI · ${new Date().toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</div><div class="content">${escaped}</div></main></body></html>`;
}

function fileSafe(value: string) {
  return value.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "cpipos-ai-document";
}

async function pruneExpiredDocuments(scope: AiDocumentScope) {
  const db = getSupabaseServiceClient();
  const now = new Date().toISOString();
  const { data, error } = await db.from("pos_ai_documents")
    .select("id,storage_path")
    .eq("tenant_id", scope.tenantId)
    .lt("expires_at", now)
    .limit(25)
    .returns<Array<{ id: string; storage_path: string }>>();
  if (error) throw new Error(`ai_documents_retention_scan_failed:${error.message}`);
  if (!data?.length) return;
  await db.storage.from(BUCKET).remove(data.map((row) => row.storage_path));
  const ids=data.map((row)=>row.id);
  const deleted=await db.from("pos_ai_documents").delete().in("id",ids);
  if(deleted.error) throw new Error(`ai_documents_retention_delete_failed:${deleted.error.message}`);
}

export async function listAiDocuments(scope: AiDocumentScope): Promise<AiDocumentRow[]> {
  await pruneExpiredDocuments(scope);
  const db = getSupabaseServiceClient();
  const { data, error } = await db.from("pos_ai_documents")
    .select("id,title,document_type,file_name,mime_type,storage_path,size_bytes,source_room_id,created_at,expires_at")
    .eq("tenant_id", scope.tenantId)
    .eq("branch_id", scope.branchId)
    .eq("user_id", scope.userId)
    .order("created_at",{ascending:false})
    .limit(200)
    .returns<AiDocumentRow[]>();
  if(error) throw new Error(`ai_documents_list_failed:${error.message}`);
  return data ?? [];
}

export async function saveAiDocument(input: AiDocumentScope & {
  title: string;
  content: string;
  sourceRoomId?: string | null;
  documentType?: string | null;
}) {
  const quota=await loadAiQuotaStatus(input.tenantId);
  if(!quota.enabled) throw new Error("ai_documents_disabled");
  const db=getSupabaseServiceClient();
  await pruneExpiredDocuments(input);

  const [{ count, error: countError }, { data: sumRows, error: sumError }] = await Promise.all([
    db.from("pos_ai_documents").select("id",{count:"exact",head:true}).eq("tenant_id",input.tenantId),
    db.from("pos_ai_documents").select("size_bytes").eq("tenant_id",input.tenantId).returns<Array<{size_bytes:number}>>()
  ]);
  if(countError) throw new Error(`ai_documents_count_failed:${countError.message}`);
  if(sumError) throw new Error(`ai_documents_size_failed:${sumError.message}`);
  const totalBytes=(sumRows??[]).reduce((sum,row)=>sum+Number(row.size_bytes??0),0);
  if(quota.documents.file_limit && Number(count??0)>=quota.documents.file_limit) throw new Error("ai_document_file_limit_reached");
  if(quota.documents.storage_mb && totalBytes>=quota.documents.storage_mb*1024*1024) throw new Error("ai_document_storage_limit_reached");

  const title=String(input.title??"").trim().slice(0,180) || "เอกสาร CpiPOS AI";
  const content=String(input.content??"").trim().slice(0,120000);
  if(!content) throw new Error("ai_document_content_required");
  const html=htmlDocument(title,content);
  const bytes=Buffer.from(html,"utf8");
  if(quota.documents.storage_mb && totalBytes+bytes.length>quota.documents.storage_mb*1024*1024) throw new Error("ai_document_storage_limit_reached");

  const id=crypto.randomUUID();
  const fileName=`${fileSafe(title)}-${id.slice(0,8)}.html`;
  const storagePath=`${input.tenantId}/${input.branchId}/${input.userId}/${fileName}`;
  const uploaded=await db.storage.from(BUCKET).upload(storagePath,bytes,{contentType:"text/html; charset=utf-8",upsert:false});
  if(uploaded.error) throw new Error(`ai_document_upload_failed:${uploaded.error.message}`);

  const retentionDays=quota.documents.retention_days;
  const expiresAt=retentionDays ? new Date(Date.now()+retentionDays*86400000).toISOString() : null;
  const inserted=await db.from("pos_ai_documents").insert({
    id,
    tenant_id:input.tenantId,
    branch_id:input.branchId,
    user_id:input.userId,
    source_room_id:input.sourceRoomId??null,
    title,
    document_type:input.documentType??"ai_summary",
    file_name:fileName,
    mime_type:"text/html",
    storage_path:storagePath,
    size_bytes:bytes.length,
    expires_at:expiresAt
  }).select("id,title,document_type,file_name,mime_type,storage_path,size_bytes,source_room_id,created_at,expires_at").single<AiDocumentRow>();
  if(inserted.error){
    await db.storage.from(BUCKET).remove([storagePath]);
    throw new Error(`ai_document_metadata_failed:${inserted.error.message}`);
  }
  return inserted.data;
}

export async function signedAiDocumentUrl(scope: AiDocumentScope, documentId: string) {
  const db=getSupabaseServiceClient();
  const row=await db.from("pos_ai_documents")
    .select("id,storage_path")
    .eq("id",documentId).eq("tenant_id",scope.tenantId).eq("branch_id",scope.branchId).eq("user_id",scope.userId)
    .maybeSingle<{id:string;storage_path:string}>();
  if(row.error) throw new Error(`ai_document_lookup_failed:${row.error.message}`);
  if(!row.data) return null;
  const signed=await db.storage.from(BUCKET).createSignedUrl(row.data.storage_path,300);
  if(signed.error) throw new Error(`ai_document_signed_url_failed:${signed.error.message}`);
  return signed.data.signedUrl;
}

export async function deleteAiDocument(scope: AiDocumentScope, documentId: string) {
  const db=getSupabaseServiceClient();
  const row=await db.from("pos_ai_documents")
    .select("id,storage_path")
    .eq("id",documentId).eq("tenant_id",scope.tenantId).eq("branch_id",scope.branchId).eq("user_id",scope.userId)
    .maybeSingle<{id:string;storage_path:string}>();
  if(row.error) throw new Error(`ai_document_lookup_failed:${row.error.message}`);
  if(!row.data) return;
  const removed=await db.storage.from(BUCKET).remove([row.data.storage_path]);
  if(removed.error) throw new Error(`ai_document_remove_failed:${removed.error.message}`);
  const deleted=await db.from("pos_ai_documents").delete().eq("id",documentId);
  if(deleted.error) throw new Error(`ai_document_delete_failed:${deleted.error.message}`);
}
