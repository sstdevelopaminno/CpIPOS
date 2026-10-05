"use client";

import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Head = {
  conversation_id: string;
  latest_sender_type: string | null;
  latest_message_preview: string | null;
  unread_store_count: number;
  assigned_user_name: string | null;
  status: string;
};

async function loadHeads() {
  const response = await fetch("/api/pos/support-chat/conversations", { cache: "no-store" });
  const json = await response.json().catch(() => null) as { data?: { conversations?: Head[] } } | null;
  return response.ok ? (json?.data?.conversations ?? []) : [];
}

function announceUnread(total: number) {
  window.dispatchEvent(new CustomEvent("cpipos-pos-support-unread", { detail: { total } }));
}

export function PosSupportNotifier() {
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);
  const [activeConversationId, setActiveConversationId] = useState("");
  const broadcastRef = useRef<RealtimeChannel | null>(null);
  const headsRef = useRef(new Map<string, Head>());

  useEffect(() => {
    let alive = true;
    let realtimeHealthy = false;
    const supabase = getSupabaseBrowserClient();

    const publishLocalHeads = (preferredConversationId?: string) => {
      const heads = Array.from(headsRef.current.values());
      announceUnread(heads.reduce((sum, row) => sum + Number(row.unread_store_count || 0), 0));
      setActiveConversationId((current) => {
        if (preferredConversationId && headsRef.current.get(preferredConversationId)?.status !== "closed") {
          return preferredConversationId;
        }
        if (current && headsRef.current.get(current)?.status !== "closed") return current;
        return heads.find((row) => row.status !== "closed")?.conversation_id ?? "";
      });
    };

    const refresh = async () => {
      const heads = await loadHeads().catch(() => []);
      if (!alive) return;
      headsRef.current = new Map(heads.map((row) => [row.conversation_id, row]));
      publishLocalHeads();
    };

    void refresh();
    const channel = supabase.channel("pos-support-global-notifier")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_chat_heads" }, (payload) => {
        const next = (payload.new ?? {}) as Partial<Head>;
        const previous = (payload.old ?? {}) as Partial<Head>;
        if (!alive) return;

        const conversationId = next.conversation_id || previous.conversation_id;
        if (conversationId) {
          if (payload.eventType === "DELETE") {
            headsRef.current.delete(conversationId);
          } else {
            const current = headsRef.current.get(conversationId);
            headsRef.current.set(conversationId, { ...current, ...next, conversation_id: conversationId } as Head);
          }
          publishLocalHeads(next.status !== "closed" ? conversationId : undefined);
        }

        if (next.latest_sender_type === "it" && next.latest_message_preview) {
          const title = next.assigned_user_name ? `ข้อความจาก ${next.assigned_user_name}` : "ข้อความใหม่จาก IT Support";
          setToast({ title, message: next.latest_message_preview });
          window.setTimeout(() => setToast(null), 5000);
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          realtimeHealthy = true;
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          realtimeHealthy = false;
          window.setTimeout(() => {
            if (alive) void refresh();
          }, 1500);
        }
      });

    const onPush = (event: Event) => {
      const payload = (event as CustomEvent<{ title?: string; body?: string; kind?: string }>).detail;
      if (payload?.kind !== "chat") return;
      setToast({ title: payload.title || "ข้อความใหม่", message: payload.body || "" });
      window.setTimeout(() => setToast(null), 5000);
      if (!realtimeHealthy) void refresh();
    };
    const onRecovery = () => { if (alive) void refresh(); };
    const onVisible = () => { if (document.visibilityState === "visible") onRecovery(); };
    window.addEventListener("cpipos-pos-push-notification", onPush);
    window.addEventListener("focus", onRecovery);
    window.addEventListener("online", onRecovery);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      window.removeEventListener("cpipos-pos-push-notification", onPush);
      window.removeEventListener("focus", onRecovery);
      window.removeEventListener("online", onRecovery);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!activeConversationId) return;
    const supabase = getSupabaseBrowserClient();
    const channel = supabase.channel(`support-chat-typing:${activeConversationId}`)
      .on("broadcast", { event: "message_preview" }, ({ payload }) => {
        const event = payload as { actor?: string; message?: string; name?: string };
        if (event.actor !== "it" || !event.message) return;
        setToast({ title: event.name ? `ข้อความจาก ${event.name}` : "ข้อความใหม่จาก IT Support", message: event.message });
        window.setTimeout(() => setToast(null), 5000);
        try {
          const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (AudioCtx) {
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0.035;
            osc.frequency.value = 760;
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(); osc.stop(ctx.currentTime + 0.12);
          }
        } catch {}
      })
      .subscribe();
    broadcastRef.current = channel;
    return () => {
      broadcastRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [activeConversationId]);

  if (!toast) return null;
  return <button type="button" onClick={() => window.location.assign("/preview/pos/payments/support")}
    className="fixed right-5 top-5 z-[700] w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-blue-200 bg-white p-4 text-left shadow-2xl">
    <div className="text-sm font-black text-slate-950">{toast.title}</div>
    <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{toast.message}</div>
    <div className="mt-2 text-[10px] font-black text-blue-600">เปิดแชท</div>
  </button>;
}
