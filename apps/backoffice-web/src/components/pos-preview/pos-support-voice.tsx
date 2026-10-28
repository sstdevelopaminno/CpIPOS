"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SupportVoiceCallOverlay } from "@/components/support/support-voice-call-overlay";
import {
  useSupportVoiceCall,
  type SupportVoiceCall
} from "@/components/support/use-support-voice-call";

type Envelope<T> = {
  data?: T;
  error?: { code?: string; message?: string };
};

type VoiceQueueSnapshot = {
  position: number;
  ahead_count: number;
  waiting_count: number;
  active_calls: number;
  queued_since: string | null;
  lease_seconds: number;
};

type VoiceControlData = {
  call?: SupportVoiceCall | null;
  ice_servers?: RTCIceServer[];
  turn_enabled?: boolean;
  queue?: VoiceQueueSnapshot | null;
};

type PosSupportVoiceProps = {
  conversationId: string;
  conversationOpen: boolean;
  storeName: string;
  activeCall: SupportVoiceCall | null;
  onCallChange: (call: SupportVoiceCall | null) => void;
  onRefresh: () => Promise<void> | void;
};

type QueueAudioState = {
  context: AudioContext;
  source: AudioBufferSourceNode;
};

function isActive(call: SupportVoiceCall | null) {
  return Boolean(call && ["requested", "accepted", "connecting", "connected"].includes(call.status));
}

function isStoreWaiting(call: SupportVoiceCall | null) {
  return Boolean(call && call.direction === "store_to_it" && call.status === "requested");
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
  const [queue, setQueue] = useState<VoiceQueueSnapshot | null>(null);
  const queueRef = useRef<VoiceQueueSnapshot | null>(null);
  const queueAudioRef = useRef<QueueAudioState | null>(null);
  const queuePollTimerRef = useRef<number | null>(null);
  const queueAnnouncementTimerRef = useRef<number | null>(null);
  const queuePollFailuresRef = useRef(0);

  const updateQueue = useCallback((next: VoiceQueueSnapshot | null) => {
    queueRef.current = next;
    setQueue(next);
  }, []);

  const stopWaitingMedia = useCallback(() => {
    if (queuePollTimerRef.current) window.clearTimeout(queuePollTimerRef.current);
    if (queueAnnouncementTimerRef.current) window.clearInterval(queueAnnouncementTimerRef.current);
    queuePollTimerRef.current = null;
    queueAnnouncementTimerRef.current = null;
    queuePollFailuresRef.current = 0;

    const audio = queueAudioRef.current;
    queueAudioRef.current = null;
    if (audio) {
      try { audio.source.stop(); } catch {}
      void audio.context.close().catch(() => null);
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const startWaitingMusic = useCallback(async () => {
    if (queueAudioRef.current || typeof window === "undefined") return;
    const AudioContextCtor = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    try {
      const context = new AudioContextCtor();
      const seconds = 12;
      const frameCount = Math.floor(context.sampleRate * seconds);
      const buffer = context.createBuffer(1, frameCount, context.sampleRate);
      const data = buffer.getChannelData(0);
      const notes = [261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 349.23, 261.63, 329.63, 392, 523.25];
      const noteFrames = Math.floor(context.sampleRate);

      for (let i = 0; i < frameCount; i += 1) {
        const noteIndex = Math.min(notes.length - 1, Math.floor(i / noteFrames));
        const phaseInNote = (i % noteFrames) / noteFrames;
        const fadeIn = Math.min(1, phaseInNote * 5);
        const fadeOut = Math.min(1, (1 - phaseInNote) * 5);
        const envelope = Math.sin(Math.PI * Math.min(fadeIn, fadeOut));
        data[i] = Math.sin(2 * Math.PI * notes[noteIndex] * (i / context.sampleRate)) * envelope * 0.025;
      }

      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.connect(context.destination);
      queueAudioRef.current = { context, source };
      source.start();
      if (context.state === "suspended") await context.resume().catch(() => null);
    } catch {
      const audio = queueAudioRef.current;
      queueAudioRef.current = null;
      if (audio) {
        try { audio.source.stop(); } catch {}
        void audio.context.close().catch(() => null);
      }
    }
  }, []);

  const speakQueueAnnouncement = useCallback((snapshot: VoiceQueueSnapshot | null) => {
    if (
      typeof window === "undefined" ||
      !("speechSynthesis" in window) ||
      typeof SpeechSynthesisUtterance === "undefined"
    ) return;

    const message = snapshot?.position
      ? snapshot.position > 1
        ? `ขณะนี้เจ้าหน้าที่กำลังให้บริการลูกค้าท่านอื่น กรุณารอสักครู่ คุณอยู่ในคิวลำดับที่ ${snapshot.position}`
        : "ขณะนี้คุณอยู่คิวแรก กรุณารอสักครู่ เจ้าหน้าที่จะรับสายของคุณโดยเร็วที่สุด"
      : "กำลังติดต่อทีมซัพพอร์ต กรุณารอสักครู่ ระบบกำลังจัดคิวให้คุณ";

    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.lang = "th-TH";
      utterance.rate = 0.92;
      utterance.pitch = 1;
      utterance.volume = 1;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Waiting music and visible queue text remain available as a fallback.
    }
  }, []);

  const request = useCallback(async (
    action: "voice_request" | "voice_accept" | "voice_decline" | "voice_cancel" | "voice_end" | "voice_state" | "voice_ice" | "voice_queue",
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
    if ("queue" in json.data) updateQueue(json.data.queue ?? null);
    return json.data;
  }, [conversationId, onCallChange, updateQueue]);

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
    stopWaitingMedia();
    await request("voice_end", { call_id: activeCall.id }).catch(() => null);
    updateQueue(null);
    onCallChange(null);
    await Promise.resolve(onRefresh()).catch(() => null);
  }, [activeCall?.id, onCallChange, onRefresh, request, stopWaitingMedia, updateQueue]);

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
  ): Promise<VoiceControlData | null> => {
    if (!conversationOpen) return null;
    setBusy(true);
    setControlError("");
    try {
      const data = await request(action, { call_id: callId ?? null });
      if (data.call) onCallChange(data.call);
      if (!isStoreWaiting(data.call ?? null)) {
        updateQueue(null);
        stopWaitingMedia();
      }
      await Promise.resolve(onRefresh()).catch(() => null);
      return data;
    } catch (cause) {
      setControlError(cause instanceof Error ? cause.message : "ทำรายการสายเสียงไม่สำเร็จ");
      return null;
    } finally {
      setBusy(false);
    }
  }, [conversationOpen, onCallChange, onRefresh, request, stopWaitingMedia, updateQueue]);

  const beginOutboundCall = useCallback(() => {
    void startWaitingMusic();
    speakQueueAnnouncement(null);
    void control("voice_request").then((data) => {
      if (!data) {
        stopWaitingMedia();
      } else if (data.queue) {
        updateQueue(data.queue);
        speakQueueAnnouncement(data.queue);
      }
    });
  }, [control, speakQueueAnnouncement, startWaitingMusic, stopWaitingMedia, updateQueue]);

  const endCall = useCallback(async () => {
    if (!activeCall?.id) return;
    stopWaitingMedia();
    await voice.endLocal();
    await control("voice_end", activeCall.id);
  }, [activeCall?.id, control, stopWaitingMedia, voice]);

  useEffect(() => {
    if (!isStoreWaiting(activeCall) || !activeCall?.id) {
      updateQueue(null);
      stopWaitingMedia();
      return;
    }

    let stopped = false;
    const callId = activeCall.id;

    void startWaitingMusic();
    if (!queueAnnouncementTimerRef.current) {
      queueAnnouncementTimerRef.current = window.setInterval(() => {
        if (document.visibilityState === "visible") {
          speakQueueAnnouncement(queueRef.current);
        }
      }, 60_000);
    }

    const schedule = (delayMs: number) => {
      if (stopped) return;
      if (queuePollTimerRef.current) window.clearTimeout(queuePollTimerRef.current);
      queuePollTimerRef.current = window.setTimeout(async () => {
        if (stopped) return;
        if (document.visibilityState === "hidden") {
          schedule(30_000);
          return;
        }

        try {
          const data = await request("voice_queue", { call_id: callId });
          queuePollFailuresRef.current = 0;

          if (!data.call || data.call.status !== "requested") {
            updateQueue(null);
            stopWaitingMedia();
            await Promise.resolve(onRefresh()).catch(() => null);
            return;
          }

          const nextDelay = 12_000 + Math.floor(Math.random() * 8_000);
          schedule(nextDelay);
        } catch {
          queuePollFailuresRef.current += 1;
          const backoff = Math.min(60_000, 12_000 * (2 ** Math.min(queuePollFailuresRef.current, 2)));
          schedule(backoff + Math.floor(Math.random() * 5_000));
        }
      }, delayMs);
    };

    schedule(5_000 + Math.floor(Math.random() * 4_000));

    return () => {
      stopped = true;
      if (queuePollTimerRef.current) window.clearTimeout(queuePollTimerRef.current);
      queuePollTimerRef.current = null;
    };
  }, [
    activeCall?.id,
    activeCall?.status,
    activeCall?.direction,
    onRefresh,
    request,
    speakQueueAnnouncement,
    startWaitingMusic,
    stopWaitingMedia,
    updateQueue
  ]);

  useEffect(() => {
    if (!isActive(activeCall)) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !isStoreWaiting(activeCall)) {
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
  }, [activeCall, onRefresh]);

  useEffect(() => () => {
    stopWaitingMedia();
  }, [stopWaitingMedia]);

  return (
    <>
      {!isActive(activeCall) ? (
        <button
          type="button"
          onClick={beginOutboundCall}
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
        queuePosition={queue?.position}
        queueWaitingCount={queue?.waiting_count}
        queueActiveCalls={queue?.active_calls}
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
