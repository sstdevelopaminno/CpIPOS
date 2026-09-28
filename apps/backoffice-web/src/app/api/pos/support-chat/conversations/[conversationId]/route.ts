import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePosSession } from "@/lib/pos-session-guard";
import {
  callSupportChat,
  issuePosSupportChatBridge,
  mirrorSupportChatHead,
  type SupportChatHead
} from "@/lib/services/support-chat/support-chat-bridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  try {
    const scope = await requirePosSession();
    const { conversationId } = await context.params;
    const body = await request.json().catch(() => null) as { action?: string } | null;
    const action = String(body?.action ?? "").trim();
    if (action !== "close") return fail("unsupported_action", "คำสั่งแชทไม่ถูกต้อง", 422);

    const bridge = await issuePosSupportChatBridge(scope);
    const data = await callSupportChat<{
      conversation: Record<string, unknown>;
      head: SupportChatHead;
    }>(bridge, "close_conversation", { conversation_id: conversationId });
    await mirrorSupportChatHead(data.head);
    return ok(data);
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    const typed = error as Error & { status?: number; code?: string };
    return fail(typed.code || "support_chat_close_failed", typed.message || "ไม่สามารถจบการสนทนาได้", typed.status || 503);
  }
}
