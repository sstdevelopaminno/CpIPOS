import { hasBranchFeature } from "@/lib/feature-gate";
import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { getAiChatRoom } from "@/lib/services/ai-conversation-service";
import { createAiDocument, listAiDocuments } from "@/lib/services/ai-document-service";

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

export async function GET() {
  try {
    const checked = await guard();
    if ("response" in checked) return checked.response;
    return ok(await listAiDocuments(scope(checked.auth)));
  } catch (error) {
    console.error("[cpipos-ai-documents] list failed", error);
    return fail("ai_documents_failed", "ไม่สามารถโหลดไฟล์เอกสารได้", 500);
  }
}

export async function POST(request: Request) {
  try {
    const checked = await guard();
    if ("response" in checked) return checked.response;
    const body = (await request.json().catch(() => null)) as {
      title?: string;
      content?: string;
      format?: "markdown" | "csv" | "json";
      room_id?: string | null;
      source_message_id?: string | null;
    } | null;
    const content = String(body?.content ?? "").trim();
    if (!content) return fail("ai_document_content_required", "ไม่มีเนื้อหาสำหรับบันทึก", 422);

    const aiScope = {
      tenantId: checked.auth.tenantId!,
      branchId: checked.auth.branchId!,
      userId: checked.auth.userId,
      role: checked.auth.branchRole ?? "unknown"
    };
    const roomId = String(body?.room_id ?? "").trim() || null;
    if (roomId && !(await getAiChatRoom(aiScope, roomId))) {
      return fail("ai_document_room_forbidden", "ไม่พบห้องแชทที่เป็นของผู้ใช้นี้", 403);
    }

    const document = await createAiDocument(scope(checked.auth), {
      title: body?.title,
      content,
      format: body?.format,
      roomId,
      sourceMessageId: String(body?.source_message_id ?? "").trim() || null
    });
    return ok({ document });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ai_document_storage_quota_exhausted") {
      return fail("ai_document_storage_quota_exhausted", "พื้นที่เก็บเอกสารของแพ็กเกจนี้เต็มแล้ว", 409);
    }
    if (message === "ai_document_file_too_large") {
      return fail("ai_document_file_too_large", "เอกสารมีขนาดใหญ่เกินกว่าที่แพ็กเกจกำหนด", 413);
    }
    if (message === "ai_document_policy_not_configured") {
      return fail("ai_document_policy_not_configured", "ยังไม่ได้ตั้งพื้นที่เก็บเอกสารสำหรับแพ็กเกจนี้", 403);
    }
    console.error("[cpipos-ai-documents] create failed", error);
    return fail("ai_document_create_failed", "ไม่สามารถบันทึกเอกสารได้", 500);
  }
}
