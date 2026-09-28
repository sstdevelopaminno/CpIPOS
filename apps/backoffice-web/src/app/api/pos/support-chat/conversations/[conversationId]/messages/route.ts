import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import {
  callSupportChat,
  issuePosSupportChatBridge,
  mirrorSupportChatHead,
  type SupportChatHead
} from "@/lib/services/support-chat/support-chat-bridge";
import { enforceRateLimit, getClientIpAddress } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function idFromParams(params: { conversationId?: string }) {
  return String(params.conversationId ?? "").trim();
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  try {
    const scope = await requirePosSession();
    const { conversationId } = await context.params;
    const bridge = await issuePosSupportChatBridge(scope);
    const data = await callSupportChat<{
      conversation: Record<string, unknown>;
      messages: Array<Record<string, unknown>>;
    }>(bridge, "get_messages", { conversation_id: idFromParams({ conversationId }) });

    const read = await callSupportChat<{ conversation: Record<string, unknown>; head: SupportChatHead }>(
      bridge, "mark_read", { conversation_id: conversationId }
    ).catch(() => null);
    if (read?.head) await mirrorSupportChatHead(read.head).catch(() => null);

    return ok(data);
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    const typed = error as Error & { status?: number; code?: string };
    return fail(typed.code || "support_chat_messages_failed", typed.message || "ไม่สามารถโหลดข้อความได้", typed.status || 503);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  try {
    const scope = await requirePosSession();
    const { conversationId } = await context.params;
    const body = await request.json().catch(() => null) as { message?: string } | null;
    const message = String(body?.message ?? "").trim().slice(0, 4000);
    if (!message) return fail("message_required", "กรุณาพิมพ์ข้อความ", 422);

    const rate = await enforceRateLimit({
      namespace: "pos-support-chat-message",
      key: `${conversationId}:${getClientIpAddress(request)}`,
      max: 30,
      windowMs: 5 * 60_000,
      failClosedOnBackendError: true
    });
    if (!rate.ok) return fail("support_chat_rate_limited", "ส่งข้อความถี่เกินไป กรุณารอสักครู่", 429);

    const bridge = await issuePosSupportChatBridge(scope);
    const data = await callSupportChat<{
      message: Record<string, unknown>;
      conversation: Record<string, unknown>;
      head: SupportChatHead;
    }>(bridge, "send_message", { conversation_id: conversationId, message });
    await mirrorSupportChatHead(data.head);
    return ok(data);
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    const typed = error as Error & { status?: number; code?: string };
    return fail(typed.code || "support_chat_send_failed", typed.message || "ไม่สามารถส่งข้อความได้", typed.status || 503);
  }
}
