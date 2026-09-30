import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { fail, ok } from "@/lib/http";
import { isTenantPosMenuEnabled } from "@/lib/server/pos-menu-policy-service";
import { deleteAiChatRoom, getAiChatRoom, listAiConversationMessages, publicAiChatRoom, renameAiChatRoom } from "@/lib/services/ai-conversation-service";
import { loadAiQuotaStatus } from "@/lib/services/ai-usage-service";

export const runtime = "nodejs";

function canUseAi(branchRole: string | null) {
  return branchRole === "owner" || branchRole === "manager";
}

function scopeFrom(auth: Awaited<ReturnType<typeof getPosApiAuthContext>>) {
  if (!auth.tenantId || !auth.branchId) throw new Error("missing_pos_scope");
  return {
    tenantId: auth.tenantId,
    branchId: auth.branchId,
    userId: auth.userId,
    role: auth.branchRole ?? "unknown"
  };
}

async function guard() {
  const auth = await getPosApiAuthContext({ requireBranchScope: true });
  if (!canUseAi(auth.branchRole)) {
    return { response: fail("ai_assistant_forbidden", "CpiPOS AI ใช้งานได้เฉพาะ Owner และ Manager", 403) } as const;
  }
  if (!auth.tenantId || !(await isTenantPosMenuEnabled(auth.tenantId, "main.ai_assistant"))) {
    return { response: fail("ai_assistant_disabled_by_it", "CpiPOS AI ถูกปิดสำหรับร้านนี้", 403) } as const;
  }
  const quota = await loadAiQuotaStatus(auth.tenantId);
  if (!quota.enabled) {
    return { response: fail("ai_quota_disabled", "แพ็กเกจของร้านนี้ยังไม่ได้เปิด CpiPOS AI", 403) } as const;
  }
  return { auth, quota } as const;
}

export async function GET(_request: Request, context: { params: Promise<{ roomId: string }> }) {
  try {
    const checked = await guard();
    if ("response" in checked) return checked.response;
    const { roomId } = await context.params;
    const room = await getAiChatRoom(scopeFrom(checked.auth), roomId);
    if (!room) return fail("ai_chat_room_not_found", "ไม่พบห้องแชทนี้", 404);
    const messages = await listAiConversationMessages(room.openai_conversation_id, 120);
    return ok({ room: publicAiChatRoom(room), messages });
  } catch (error) {
    console.error("[cpipos-ai] room messages failed", error);
    return fail("ai_chat_room_messages_failed", "ไม่สามารถโหลดข้อความห้องแชทนี้ได้", 500);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ roomId: string }> }) {
  try {
    const checked = await guard();
    if ("response" in checked) return checked.response;
    const { roomId } = await context.params;
    const body = (await request.json().catch(() => null)) as { title?: string } | null;
    const title = String(body?.title ?? "").trim();
    if (!title) return fail("invalid_ai_chat_room_title", "กรุณาระบุชื่อห้องแชท", 422);
    const room = await renameAiChatRoom(scopeFrom(checked.auth), roomId, title);
    return ok({ room: publicAiChatRoom(room) });
  } catch (error) {
    console.error("[cpipos-ai] room rename failed", error);
    return fail("ai_chat_room_rename_failed", "ไม่สามารถเปลี่ยนชื่อห้องแชทได้", 500);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ roomId: string }> }) {
  try {
    const checked = await guard();
    if ("response" in checked) return checked.response;
    const { roomId } = await context.params;
    await deleteAiChatRoom(scopeFrom(checked.auth), roomId);
    return ok({ deleted: true, room_id: roomId });
  } catch (error) {
    console.error("[cpipos-ai] room delete failed", error);
    return fail("ai_chat_room_delete_failed", "ไม่สามารถลบห้องแชทได้ในขณะนี้", 500);
  }
}
