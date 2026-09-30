import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { fail, ok } from "@/lib/http";
import { isTenantPosMenuEnabled } from "@/lib/server/pos-menu-policy-service";
import {
  listAiDocuments,
  loadAiDocumentPolicy,
  loadAiDocumentUsage,
  pruneExpiredAiDocuments,
  saveAiDocument
} from "@/lib/services/ai-document-vault-service";
import { loadAiQuotaStatus } from "@/lib/services/ai-usage-service";

export const runtime = "nodejs";

function canUseVault(role: string | null) {
  return role === "owner" || role === "manager";
}

async function guard() {
  const auth = await getPosApiAuthContext({ requireBranchScope: true });
  if (!canUseVault(auth.branchRole)) return { response: fail("ai_documents_forbidden", "ใช้งานได้เฉพาะ Owner และ Manager", 403) } as const;
  if (!auth.tenantId || !auth.branchId) return { response: fail("missing_pos_scope", "ไม่พบขอบเขตร้าน/สาขา", 403) } as const;
  const [menuAllowed, aiQuota, policy] = await Promise.all([
    isTenantPosMenuEnabled(auth.tenantId, "more.ai_documents"),
    loadAiQuotaStatus(auth.tenantId),
    loadAiDocumentPolicy(auth.tenantId)
  ]);
  if (!menuAllowed) return { response: fail("ai_documents_disabled_by_it", "เมนูเก็บไฟล์เอกสารถูกปิดโดยผู้ดูแลระบบ", 403) } as const;
  if (!aiQuota.enabled) return { response: fail("ai_documents_ai_required", "แพ็กเกจของร้านนี้ยังไม่ได้เปิด CpiPOS AI", 403) } as const;
  if (!policy.enabled) return { response: fail("ai_documents_package_disabled", "แพ็กเกจนี้ยังไม่เปิดพื้นที่เก็บเอกสาร AI", 403) } as const;
  return { auth, policy } as const;
}

export async function GET() {
  try {
    const checked = await guard();
    if ("response" in checked) return checked.response;
    await pruneExpiredAiDocuments(checked.auth.tenantId!, 20);
    const [documents, usage] = await Promise.all([
      listAiDocuments(checked.auth.tenantId!, checked.auth.branchId!),
      loadAiDocumentUsage(checked.auth.tenantId!)
    ]);
    return ok({ documents, usage, policy: checked.policy });
  } catch (error) {
    console.error("[cpipos-ai-documents] list failed", error);
    return fail("ai_documents_failed", "ไม่สามารถโหลดไฟล์เอกสารได้ในขณะนี้", 500);
  }
}

export async function POST(request: Request) {
  try {
    const checked = await guard();
    if ("response" in checked) return checked.response;
    const body = (await request.json().catch(() => null)) as {
      title?: string;
      category?: string;
      content?: string;
      room_id?: string | null;
      source_message_id?: string | null;
    } | null;
    const content = String(body?.content ?? "").trim();
    if (!content) return fail("ai_document_content_required", "ไม่มีเนื้อหาเอกสารให้บันทึก", 422);

    const saved = await saveAiDocument({
      tenantId: checked.auth.tenantId!,
      branchId: checked.auth.branchId!,
      userId: checked.auth.userId,
      roomId: body?.room_id ?? null,
      title: body?.title ?? "เอกสารจาก CpiPOS AI",
      category: body?.category ?? "general",
      content,
      sourceMessageId: body?.source_message_id ?? null
    });
    const usage = await loadAiDocumentUsage(checked.auth.tenantId!);
    return ok({ document: saved.document, usage, policy: saved.policy }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ai_document_vault_disabled") return fail("ai_document_vault_disabled", "แพ็กเกจนี้ยังไม่เปิดพื้นที่เก็บเอกสาร AI", 403);
    if (message === "ai_document_file_limit_reached") return fail("ai_document_file_limit_reached", "จำนวนไฟล์เอกสารของแพ็กเกจนี้เต็มแล้ว", 409);
    if (message === "ai_document_storage_limit_reached") return fail("ai_document_storage_limit_reached", "พื้นที่เก็บไฟล์เอกสารของแพ็กเกจนี้เต็มแล้ว", 409);
    if (message === "ai_document_content_too_large") return fail("ai_document_content_too_large", "เอกสารมีขนาดใหญ่เกินไป กรุณาแบ่งเป็นหลายไฟล์", 413);
    console.error("[cpipos-ai-documents] save failed", error);
    return fail("ai_document_save_failed", "ไม่สามารถบันทึกเอกสารได้ในขณะนี้", 500);
  }
}
