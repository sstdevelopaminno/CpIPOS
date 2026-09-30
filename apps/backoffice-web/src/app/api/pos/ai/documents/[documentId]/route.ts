import { hasBranchFeature } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { createAiDocumentSignedUrl, deleteAiDocument, getAiDocumentText } from "@/lib/services/ai-document-service";

export const runtime = "nodejs";

function canUse(role: string | null) {
  return role === "owner" || role === "manager";
}

function scope(auth: Awaited<ReturnType<typeof getPosApiAuthContext>>) {
  if (!auth.tenantId || !auth.branchId) throw new Error("missing_pos_scope");
  return { tenantId: auth.tenantId, branchId: auth.branchId, userId: auth.userId };
}

async function guard() {
  const auth = await getPosApiAuthContext({ requireBranchScope: true });
  if (!canUse(auth.branchRole)) return { response: fail("ai_documents_forbidden", "ใช้ได้เฉพาะ Owner และ Manager", 403) } as const;
  if (!auth.tenantId || !auth.branchId) return { response: fail("ai_documents_scope_required", "ไม่พบขอบเขตร้าน/สาขา", 403) } as const;
  if (!(await hasBranchFeature(auth.tenantId, auth.branchId, "ai_document_vault"))) {
    return { response: fail("ai_documents_package_locked", "แพ็กเกจของร้านนี้ยังไม่ได้เปิดเก็บไฟล์เอกสาร AI", 403) } as const;
  }
  return { auth } as const;
}

export async function GET(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const checked = await guard();
    if ("response" in checked) return checked.response;
    const { documentId } = await context.params;
    const mode = new URL(request.url).searchParams.get("mode");
    if (mode === "content") {
      const result = await getAiDocumentText(scope(checked.auth), documentId);
      if (!result) return fail("ai_document_not_found", "ไม่พบเอกสาร", 404);
      return ok(result);
    }
    const result = await createAiDocumentSignedUrl(scope(checked.auth), documentId);
    if (!result) return fail("ai_document_not_found", "ไม่พบเอกสาร", 404);
    return ok(result);
  } catch (error) {
    console.error("[cpipos-ai-documents] read failed", error);
    return fail("ai_document_read_failed", "ไม่สามารถเปิดเอกสารได้", 500);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const checked = await guard();
    if ("response" in checked) return checked.response;
    const { documentId } = await context.params;
    await deleteAiDocument(scope(checked.auth), documentId);
    return ok({ deleted: true, document_id: documentId });
  } catch (error) {
    console.error("[cpipos-ai-documents] delete failed", error);
    return fail("ai_document_delete_failed", "ไม่สามารถลบเอกสารได้", 500);
  }
}
