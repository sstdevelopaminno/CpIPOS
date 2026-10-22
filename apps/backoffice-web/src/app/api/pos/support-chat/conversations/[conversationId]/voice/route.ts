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

type VoiceAction =
  | "voice_request"
  | "voice_accept"
  | "voice_decline"
  | "voice_cancel"
  | "voice_end"
  | "voice_state"
  | "voice_ice"
  | "voice_queue";

type VoiceResponse = {
  call?: Record<string, unknown>;
  conversation?: Record<string, unknown>;
  head?: SupportChatHead;
  ice_servers?: RTCIceServer[];
  turn_enabled?: boolean;
  queue?: {
    position: number;
    ahead_count: number;
    waiting_count: number;
    active_calls: number;
    queued_since: string | null;
    lease_seconds: number;
  } | null;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> }
) {
  try {
    const scope = await requirePosSession();
    const { conversationId } = await context.params;
    const body = await request.json().catch(() => null) as {
      action?: VoiceAction;
      call_id?: string | null;
      state?: "connecting" | "connected";
    } | null;

    const action = body?.action;
    if (!action) return fail("voice_action_required", "ไม่พบคำสั่งสายเสียง", 422);

    const rate = await enforceRateLimit({
      namespace: "pos-support-voice",
      key: `${scope.session.tenant_id}:${conversationId}:${getClientIpAddress(request)}`,
      max: action === "voice_ice" || action === "voice_state" || action === "voice_queue" ? 120 : 30,
      windowMs: 10 * 60_000,
      failClosedOnBackendError: true
    });
    if (!rate.ok) return fail("support_voice_rate_limited", "ทำรายการสายเสียงถี่เกินไป กรุณารอสักครู่", 429);

    const bridge = await issuePosSupportChatBridge(scope);
    const callId = String(body?.call_id ?? "").trim();

    let backendAction = "";
    const data: Record<string, unknown> = { conversation_id: conversationId };

    if (action === "voice_request") {
      backendAction = "request_voice_call";
      data.origin = "cpipos_app";
    } else if (action === "voice_accept") {
      backendAction = "accept_voice_call";
      data.call_id = callId;
    } else if (action === "voice_decline") {
      backendAction = "decline_voice_call";
      data.call_id = callId;
    } else if (action === "voice_cancel") {
      backendAction = "cancel_voice_call";
      data.call_id = callId;
    } else if (action === "voice_end") {
      backendAction = "end_voice_call";
      data.call_id = callId;
    } else if (action === "voice_state") {
      backendAction = "update_voice_call_state";
      data.call_id = callId;
      data.state = body?.state;
    } else if (action === "voice_ice") {
      backendAction = "get_voice_ice_config";
      data.call_id = callId;
    } else if (action === "voice_queue") {
      backendAction = "get_voice_queue_status";
      data.call_id = callId;
    }

    if (action !== "voice_request" && !callId) {
      return fail("call_id_required", "ไม่พบสายเสียง", 422);
    }

    const result = await callSupportChat<VoiceResponse>(bridge, backendAction, data);
    if (result.head) await mirrorSupportChatHead(result.head).catch(() => null);

    const response = ok(result);
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    if (error instanceof PosGuardError) return fail(error.code, error.message, error.status);
    const typed = error as Error & { status?: number; code?: string };
    return fail(
      typed.code || "support_voice_failed",
      typed.message || "ไม่สามารถใช้งานสายเสียง Support ได้",
      typed.status || 503
    );
  }
}
