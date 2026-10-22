"use client";

import { useCallback, useEffect, useState } from "react";
import { SupportVoiceCallOverlay } from "@/components/support/support-voice-call-overlay";
import {
  useSupportVoiceCall,
  type SupportVoiceCall
} from "@/components/support/use-support-voice-call";

type Envelope<T> = {
  data?: T;
  error?: { code?: string; message?: string };
};

type VoiceControlData = {
  call?: SupportVoiceCall | null;
  ice_servers?: RTCIceServer[];
  turn_enabled?: boolean;
};

type PosSupportVoiceProps = {
  conversationId: string;
  conversationOpen: boolean;
  storeName: string;
  activeCall: SupportVoiceCall | null;
  onCallChange: (call: SupportVoiceCall | null) => void;
  onRefresh: () => Promise<void> | void;
};

function isActive(call: SupportVoiceCall | null) {
  return Boolean(call && ["requested", "accepted", "connecting", "connected"].includes(call.status));
}

export function PosSupportVoice({
  conversationId,
  conversationOpen,
  storeName,
  activeCall,
  onCallChange,
  onRefresh
}: PosSupportVoiceProps) {
  const [busy, setBusy] = useState(false);
  const [controlError, setControlError] = useState("");

  const request = useCallback(async (
    action: "voice_request" | "voice_accept" | "voice_decline" | "voice_cancel" | "voice_end" | "voice_state" | "voice_ice",
    extra: Record<string, unknown> = {}
  ) => {
    const response = await fetch(
      `/api/pos/support-chat/conversations/${encodeURIComponent(conversationId)}/voice`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
        cache: "no-store"
      }
    );
    const json = await response.json().catch(() => null) as Envelope<VoiceControlData> | null;
    if (!response.ok || !json?.data) {
      throw new Error(json?.error?.message || "ทำรายการสายเสียงไม่สำเร็จ");
    }
    if ("call" in json.data) onCallChange(json.data.call ?? null);
    return json.data;
  }, [conversationId, onCallChange]);

  const loadIceServers = useCallback(async () => {
    if (!activeCall?.id) throw new Error("ไม่พบห้องเสียง");
    const data = await request("voice_ice", { call_id: activeCall.id });
    if (!data.ice_servers?.length) throw new Error("ไม่พบการตั้งค่าเครือข่ายสำหรับสายเสียง");
    return data.ice_servers;
  }, [activeCall?.id, request]);

  const updateVoiceState = useCallback(async (state: "connecting" | "connected") => {
    if (!activeCall?.id) return;
    await request("voice_state", { call_id: activeCall.id, state });
  }, [activeCall?.id, request]);

  const handleRemoteHangup = useCallback(async () => {
    if (!activeCall?.id) return;
    await request("voice_end", { call_id: activeCall.id }).catch(() => null);
    onCallChange(null);
    await Promise.resolve(onRefresh()).catch(() => null);
  }, [activeCall?.id, onCallChange, onRefresh, request]);

  const voiceHeld = Boolean(
    activeCall?.transfer_status &&
    ["requested", "accepted", "returning"].includes(activeCall.transfer_status)
  );

  const voice = useSupportVoiceCall({
    call: activeCall,
    side: "store",
    loadIceServers,
    onState: updateVoiceState,
    onRemoteHangup: handleRemoteHangup,
    held: voiceHeld
  });

  const control = useCallback(async (
    action: "voice_request" | "voice_accept" | "voice_decline" | "voice_cancel" | "voice_end",
    callId?: string
  ) => {
    if (!conversationOpen) return;
    setBusy(true);
    setControlError("");
    try {
      const data = await request(action, { call_id: callId ?? null });
      if (data.call) onCallChange(data.call);
      await Promise.resolve(onRefresh()).catch(() => null);
    } catch (cause) {
      setControlError(cause instanceof Error ? cause.message : "ทำรายการสายเสียงไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }, [conversationOpen, onCallChange, onRefresh, request]);

  const endCall = useCallback(async () => {
    if (!activeCall?.id) return;
    await voice.endLocal();
    await control("voice_end", activeCall.id);
  }, [activeCall?.id, control, voice]);

  useEffect(() => {
    if (!isActive(activeCall)) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void Promise.resolve(onRefresh()).catch(() => null);
      }
    }, 30_000);
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void Promise.resolve(onRefresh()).catch(() => null);
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [activeCall?.id, activeCall?.status, onRefresh]);

  return (
    <>
      {!isActive(activeCall) ? (
        <button
          type="button"
          onClick={() => void control("voice_request")}
          disabled={!conversationOpen || busy}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
          title="โทรหา IT Support ผ่านอินเทอร์เน็ต ไม่ต้องใช้ LINE"
        >
          <span aria-hidden>☎</span>
          {busy ? "กำลังโทร…" : "โทรหา Support"}
        </button>
      ) : null}

      <SupportVoiceCallOverlay
        open={isActive(activeCall)}
        mode={
          activeCall?.status === "requested"
            ? activeCall.direction === "it_to_store"
              ? "incoming"
              : "outgoing"
            : "active"
        }
        counterpartyName={activeCall?.assigned_it_name || "CpIPOS Support"}
        counterpartyDetail={`${storeName} · โทรผ่านอินเทอร์เน็ตจาก POS`}
        phase={voice.phase}
        error={controlError || voice.error}
        busy={busy}
        canStart={voice.canStart}
        micMuted={voice.micMuted}
        speakerMuted={voice.speakerMuted}
        needsAudioResume={voice.needsAudioResume}
        elapsedSeconds={voice.elapsedSeconds}
        held={voiceHeld}
        holdLabel={activeCall?.transfer_target_name ? `กำลังโอนไปยัง ${activeCall.transfer_target_name}` : "กำลังโอนสาย"}
        onAccept={activeCall ? () => void control("voice_accept", activeCall.id) : undefined}
        onDecline={activeCall ? () => void control("voice_decline", activeCall.id) : undefined}
        onCancel={activeCall ? () => void control("voice_cancel", activeCall.id) : undefined}
        onStart={() => void voice.start()}
        onEnd={() => void endCall()}
        onToggleMic={voice.toggleMic}
        onToggleSpeaker={voice.toggleSpeaker}
        onResumeAudio={() => void voice.resumeAudio()}
      />
    </>
  );
}
