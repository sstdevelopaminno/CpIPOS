import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import {
  callSupportChat,
  issuePosSupportChatBridge,
  mirrorSupportChatHead,
  publishOptimisticSupportChatHead,
  rollbackOptimisticSupportChatHead,
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
      head: SupportChatHead;
      head_changed?: boolean;
    }>(bridge, "get_messages", {
      conversation_id: idFromParams({ conversationId }),
      mark_read: true
    });

    if (data.head_changed) {
      await mirrorSupportChatHead(data.head).catch(() => null);
    }

    return ok({ conversation: data.conversation, messages: data.messages });
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
    const body = await request.json().catch(() => null) as {
      message?: string;
      attachment?: { name?: string; mime_type?: string; size_bytes?: number; data_base64?: string };
    } | null;
    const message = String(body?.message ?? "").trim().slice(0, 4000);
    if (!message && !body?.attachment) return fail("message_required", "กรุณาพิมพ์ข้อความหรือแนบรูปภาพ", 422);

    const rate = await enforceRateLimit({
      namespace: "pos-support-chat-message",
      key: `${conversationId}:${getClientIpAddress(request)}`,
      max: 30,
      windowMs: 5 * 60_000,
      failClosedOnBackendError: true
    });
    if (!rate.ok) return fail("support_chat_rate_limited", "ส่งข้อความถี่เกินไป กรุณารอสักครู่", 429);

    const preview = body?.attachment
      ? (message ? `[รูปภาพ] ${message}` : "[รูปภาพ]")
      : message;
    const bridgePromise = issuePosSupportChatBridge(scope);
    const optimistic = await publishOptimisticSupportChatHead(conversationId, "store", preview);

    try {
      const bridge = await bridgePromise;
      const data = await callSupportChat<{
        message: Record<string, unknown>;
        conversation: Record<string, unknown>;
        head: SupportChatHead;
      }>(bridge, "send_message", {
        conversation_id: conversationId,
        message,
        attachment: body?.attachment ?? null
      });
      await mirrorSupportChatHead(data.head);
      return ok(data);
    } catch (error) {
      await rollbackOptimisticSupportChatHead(optimistic).catch(() => null);
      throw error;
    }
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    const typed = error as Error & { status?: number; code?: string };
    return fail(typed.code || "support_chat_send_failed", typed.message || "ไม่สามารถส่งข้อความได้", typed.status || 503);
  }
}
