import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { fail, ok } from "@/lib/http";
import { isTenantPosMenuEnabled } from "@/lib/server/pos-menu-policy-service";
import {
  createAiDocumentSignedUrl,
  deleteAiDocument,
  readAiDocumentContent
} from "@/lib/services/ai-document-vault-service";
import { loadAiQuotaStatus } from "@/lib/services/ai-usage-service";

export const runtime = "nodejs";

async function guard() {
  const auth = await getPosApiAuthContext({ requireBranchScope: true });
  if (auth.branchRole !== "owner" && auth.branchRole !== "manager") {
    return { response: fail("ai_documents_forbidden", "ใช้งานได้เฉพาะ Owner และ Manager", 403) } as const;
  }
  if (!auth.tenantId || !auth.branchId) return { response: fail("missing_pos_scope", "ไม่พบขอบเขตร้าน/สาขา", 403) } as const;
  const [menuAllowed, aiQuota] = await Promise.all([
    isTenantPosMenuEnabled(auth.tenantId, "more.ai_documents"),
    loadAiQuotaStatus(auth.tenantId)
  ]);
  if (!menuAllowed) return { response: fail("ai_documents_disabled_by_it", "เมนูเก็บไฟล์เอกสารถูกปิดโดยผู้ดูแลระบบ", 403) } as const;
  if (!aiQuota.enabled) return { response: fail("ai_documents_ai_required", "แพ็กเกจของร้านนี้ยังไม่ได้เปิด CpiPOS AI", 403) } as const;
  return { auth } as const;
}

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const checked = await guard();
    if ("response" in checked) return checked.response;
    const { documentId } = await context.params;
    const url = new URL(request.url);
    if (url.searchParams.get("content") === "1") {
      const result = await readAiDocumentContent(checked.auth.tenantId!, checked.auth.branchId!, documentId);
      if (!result) return fail("ai_document_not_found", "ไม่พบเอกสาร", 404);
      return ok(result);
    }
    const result = await createAiDocumentSignedUrl(checked.auth.tenantId!, checked.auth.branchId!, documentId);
    if (!result) return fail("ai_document_not_found", "ไม่พบเอกสาร", 404);
    return ok(result);
  } catch (error) {
    console.error("[cpipos-ai-documents] get failed", error);
    return fail("ai_document_get_failed", "ไม่สามารถเปิดเอกสารได้ในขณะนี้", 500);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const checked = await guard();
    if ("response" in checked) return checked.response;
    const { documentId } = await context.params;
    const deleted = await deleteAiDocument(checked.auth.tenantId!, checked.auth.branchId!, documentId);
    if (!deleted) return fail("ai_document_not_found", "ไม่พบเอกสาร", 404);
    return ok({ deleted: true });
  } catch (error) {
    console.error("[cpipos-ai-documents] delete failed", error);
    return fail("ai_document_delete_failed", "ไม่สามารถลบเอกสารได้ในขณะนี้", 500);
  }
}
