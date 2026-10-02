"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Envelope<T> = { data?: T; error?: { code?: string; message?: string } };

type Head = {
  conversation_id: string;
  tenant_id: string;
  store_code: string;
  store_name: string;
  store_logo_url: string | null;
  subject: string;
  contact_name: string;
  status: string;
  assigned_role: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  assigned_user_avatar_url: string | null;
  latest_message_at: string | null;
  latest_message_preview: string | null;
  latest_sender_type: string | null;
  unread_it_count: number;
  unread_store_count: number;
  created_at: string;
  updated_at: string;
};

type Conversation = {
  id: string;
  tenant_id: string;
  store_code: string;
  store_name: string;
  store_logo_url: string | null;
  subject: string;
  contact_name: string;
  status: string;
  assigned_role: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  assigned_user_avatar_url: string | null;
  unread_store_count: number;
  created_at: string;
  updated_at: string;
};

type Attachment = {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  url: string;
};

type Message = {
  id: string;
  sender_type: "store" | "it" | "system";
  sender_name: string;
  sender_role: string | null;
  sender_avatar_url: string | null;
  message_body: string;
  created_at: string;
  attachments?: Attachment[];
};

function initials(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("");
}

function formatTime(value: string) {
  if (!Number.isFinite(Date.parse(value))) return "";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok"
  }).format(new Date(value));
}

function Avatar({ src, label, tone = "blue" }: { src?: string | null; label: string; tone?: "blue" | "green" }) {
  if (src) {
    return <span aria-hidden="true" className="h-9 w-9 shrink-0 rounded-full border border-slate-200 bg-white bg-cover bg-center"
      style={{ backgroundImage: `url("${src.replace(/["\\]/g, "")}")` }} />;
  }
  if (tone === "green") {
    return <Image src="/brand/cpipos-symbol-sidebar.png" alt="CpIPOS" width={38} height={38}
      className="h-9 w-9 shrink-0 rounded-full border border-slate-200 bg-white object-contain" />;
  }
  return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">{initials(label)}</span>;
}

async function attachmentPayload(file: File) {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) throw new Error("รองรับเฉพาะ JPG, PNG และ WEBP");
  if (file.size > 2 * 1024 * 1024) throw new Error("รูปภาพต้องมีขนาดไม่เกิน 2 MB");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("อ่านไฟล์รูปภาพไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
  return {
    name: file.name.slice(0, 180),
    mime_type: file.type,
    size_bytes: file.size,
    data_base64: dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl
  };
}

export function PosSupportChat({ storeCode, storeName }: { storeCode: string; storeName: string }) {
  const [open, setOpen] = useState(false);
  const [heads, setHeads] = useState<Head[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [subject, setSubject] = useState("");
  const [contactName, setContactName] = useState("");
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [remoteTyping, setRemoteTyping] = useState("");
  const [closingByIT, setClosingByIT] = useState(false);
  const typingChannelRef = useRef<RealtimeChannel | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const typingSentAtRef = useRef(0);
  const headSignalRef = useRef("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const openConversation = useMemo(
    () => heads.find((row) => row.status !== "closed") ?? null,
    [heads]
  );

  const clearGoneConversation = useCallback((id: string) => {
    setHeads((current) => current.filter((row) => row.conversation_id !== id));
    setSelectedId((current) => current === id ? "" : current);
    setConversation((current) => current?.id === id ? null : current);
    setMessages([]);
    setRemoteTyping("");
    headSignalRef.current = "";
  }, []);

  const resetClosedConversation = useCallback((id: string) => {
    setHeads((current) => current.map((row) =>
      row.conversation_id === id ? { ...row, status: "closed", unread_store_count: 0 } : row
    ));
    setSelectedId((current) => current === id ? "" : current);
    setConversation((current) => current?.id === id ? null : current);
    setMessages([]);
    setDraft("");
    setAttachment(null);
    setRemoteTyping("");
    setClosingByIT(false);
    setError("");
    headSignalRef.current = "";
  }, []);

  const loadHeads = useCallback(async () => {
    setBusy("list");
    setError("");
    try {
      const response = await fetch("/api/pos/support-chat/conversations", { cache: "no-store" });
      const json = await response.json().catch(() => null) as Envelope<{ conversations: Head[] }> | null;
      if (!response.ok || !json?.data) throw new Error(json?.error?.message || "โหลดรายการแชทไม่สำเร็จ");
      setHeads(json.data.conversations);
      const current = json.data.conversations.find((row) => row.status !== "closed");
      const selected = selectedId
        ? json.data.conversations.find((row) => row.conversation_id === selectedId)
        : null;
      if (selectedId && !selected) {
        clearGoneConversation(selectedId);
        if (current) setSelectedId(current.conversation_id);
      } else if (selectedId && selected?.status === "closed") {
        resetClosedConversation(selectedId);
        if (current && current.conversation_id !== selectedId) setSelectedId(current.conversation_id);
      } else if (current && !selectedId) {
        setSelectedId(current.conversation_id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดรายการแชทไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }, [selectedId, clearGoneConversation, resetClosedConversation]);

  const loadMessages = useCallback(async (id: string) => {
    if (!id) return;
    setBusy("messages");
    setError("");
    try {
      const response = await fetch(`/api/pos/support-chat/conversations/${id}/messages`, { cache: "no-store" });
      const json = await response.json().catch(() => null) as Envelope<{ conversation: Conversation; messages: Message[] }> | null;
      if (response.status === 404) {
        clearGoneConversation(id);
        return;
      }
      if (!response.ok || !json?.data) throw new Error(json?.error?.message || "โหลดข้อความไม่สำเร็จ");
      if (json.data.conversation.status === "closed") {
        resetClosedConversation(id);
        return;
      }
      setConversation(json.data.conversation);
      setClosingByIT(false);
      setMessages(json.data.messages);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดข้อความไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }, [clearGoneConversation, resetClosedConversation]);

  useEffect(() => {
    void loadHeads();
  }, [loadHeads]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("open") === "chat") {
        setOpen(true);
        const requestedSubject = params.get("subject")?.trim();
        if (requestedSubject) setSubject(requestedSubject.slice(0, 180));
      }
    } catch {
      // Deep-link assistance is optional; the Support page still works normally.
    }
  }, []);

  useEffect(() => {
    if (!open || !selectedId) return;
    void loadMessages(selectedId);
  }, [open, selectedId, loadMessages]);

  useEffect(() => {
    let supabase: ReturnType<typeof getSupabaseBrowserClient>;
    try {
      supabase = getSupabaseBrowserClient();
    } catch {
      // Chat APIs still work without Realtime. Do not crash the whole Support
      // page when browser-side realtime configuration is temporarily missing.
      setError((current) => current || "โหมดเรียลไทม์ยังไม่พร้อม ระบบแชทยังใช้งานผ่านการรีเฟรชได้");
      return;
    }
    const channel = supabase.channel("pos-support-chat-heads")
      .on("postgres_changes", { event: "*", schema: "public", table: "support_chat_heads" }, (payload) => {
        const next = (payload.new ?? {}) as Partial<Head>;
        if (!next.conversation_id) return;

        // The realtime row already contains the compact authoritative head.
        // Update the list locally instead of issuing a list request first.
        setHeads((current) => {
          const merged = { ...(current.find((row) => row.conversation_id === next.conversation_id) ?? {}), ...next } as Head;
          return [merged, ...current.filter((row) => row.conversation_id !== next.conversation_id)];
        });

        if (!selectedId || next.conversation_id !== selectedId) return;
        if (next.status === "closed") {
          resetClosedConversation(selectedId);
          return;
        }
        const signal = [next.latest_message_at ?? "", next.status ?? "", next.assigned_user_id ?? ""].join("|");
        if (signal === headSignalRef.current) return;
        headSignalRef.current = signal;

        // Show an incoming IT reply immediately from the realtime head while
        // the canonical message history refreshes in the background.
        if (next.latest_sender_type === "it" && next.latest_message_at && next.latest_message_preview) {
          setMessages((current) => {
            if (current.some((item) =>
              item.id.startsWith("broadcast:") &&
              item.sender_type === "it" &&
              item.message_body === next.latest_message_preview
            )) return current;
            const newest = current[current.length - 1];
            if (newest && Date.parse(newest.created_at) >= Date.parse(next.latest_message_at!)) return current;
            return [...current, {
              id: `preview:${next.conversation_id}:${next.latest_message_at}`,
              sender_type: "it",
              sender_name: next.assigned_user_name || "IT Support",
              sender_role: next.assigned_role || "it_support",
              sender_avatar_url: next.assigned_user_avatar_url || null,
              message_body: next.latest_message_preview!,
              created_at: next.latest_message_at!,
              attachments: []
            }];
          });
          void loadMessages(selectedId);
          return;
        }

        if (
          next.status !== conversation?.status ||
          next.assigned_user_id !== conversation?.assigned_user_id
        ) {
          void loadMessages(selectedId);
        }
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadMessages, selectedId, conversation?.status, conversation?.assigned_user_id, resetClosedConversation]);

  useEffect(() => {
    if (!selectedId || conversation?.status === "closed") {
      setRemoteTyping("");
      return;
    }
    let supabase: ReturnType<typeof getSupabaseBrowserClient>;
    try {
      supabase = getSupabaseBrowserClient();
    } catch {
      typingChannelRef.current = null;
      setRemoteTyping("");
      return;
    }
    const channel = supabase.channel(`support-chat-typing:${selectedId}`)
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const event = payload as { actor?: string; typing?: boolean; name?: string };
        if (event.actor !== "it") return;
        if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
        setRemoteTyping(event.typing ? (event.name || "IT Support") : "");
        if (event.typing) typingTimerRef.current = window.setTimeout(() => setRemoteTyping(""), 2600);
      })
      .on("broadcast", { event: "message_preview" }, ({ payload }) => {
        const event = payload as {
          actor?: string; client_id?: string; message?: string; created_at?: string;
          name?: string; role?: string | null; avatar_url?: string | null;
        };
        if (event.actor !== "it" || !event.client_id || !event.message || !event.created_at) return;
        const id = `broadcast:${event.client_id}`;
        setRemoteTyping("");
        setMessages((current) => current.some((item) => item.id === id) ? current : [...current, {
          id,
          sender_type: "it",
          sender_name: event.name || "IT Support",
          sender_role: event.role || "it_support",
          sender_avatar_url: event.avatar_url || null,
          message_body: event.message!,
          created_at: event.created_at!,
          attachments: []
        }]);
      })
      .on("broadcast", { event: "message_retract" }, ({ payload }) => {
        const event = payload as { actor?: string; client_id?: string };
        if (event.actor !== "it" || !event.client_id) return;
        const id = `broadcast:${event.client_id}`;
        setMessages((current) => current.filter((item) => item.id !== id));
      })
      .on("broadcast", { event: "conversation_closing" }, ({ payload }) => {
        const event = payload as { actor?: string; conversation_id?: string };
        if (event.actor !== "it" || event.conversation_id !== selectedId) return;
        setClosingByIT(true);
        setRemoteTyping("");
        setDraft("");
        setAttachment(null);
      })
      .on("broadcast", { event: "conversation_closed" }, ({ payload }) => {
        const event = payload as { actor?: string; conversation_id?: string };
        if (event.actor !== "it" || event.conversation_id !== selectedId) return;
        resetClosedConversation(selectedId);
      })
      .on("broadcast", { event: "conversation_close_cancelled" }, ({ payload }) => {
        const event = payload as { actor?: string; conversation_id?: string };
        if (event.actor !== "it" || event.conversation_id !== selectedId) return;
        setClosingByIT(false);
      })
      .subscribe();
    typingChannelRef.current = channel;
    return () => {
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
      setRemoteTyping("");
      typingChannelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [selectedId, conversation?.status, resetClosedConversation]);

  const announceTyping = useCallback((typing: boolean) => {
    const now = Date.now();
    if (typing && now - typingSentAtRef.current < 700) return;
    typingSentAtRef.current = now;
    void typingChannelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { actor: "store", typing, name: contactName || storeName }
    });
  }, [contactName, storeName]);

  async function createConversation() {
    if (subject.trim().length < 2 || contactName.trim().length < 2) {
      setError("กรุณาระบุชื่อเรื่องและชื่อผู้ติดต่อ");
      return;
    }
    setBusy("create");
    setError("");
    try {
      const response = await fetch("/api/pos/support-chat/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject, contact_name: contactName })
      });
      const json = await response.json().catch(() => null) as Envelope<{
        conversation: Conversation;
        head: Head;
        already_open: boolean;
      }> | null;
      if (!response.ok || !json?.data) throw new Error(json?.error?.message || "เริ่มแชทไม่สำเร็จ");
      setHeads((current) => [json.data!.head, ...current.filter((row) => row.conversation_id !== json.data!.head.conversation_id)]);
      setSelectedId(json.data.conversation.id);
      setConversation(json.data.conversation);
      setSubject("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เริ่มแชทไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function sendMessage() {
    const message = draft.trim();
    if (!selectedId || closingByIT || (!message && !attachment)) return;

    const pendingAttachment = attachment;
    const optimisticId = `optimistic:store:${Date.now()}`;
    const optimisticMessage: Message = {
      id: optimisticId,
      sender_type: "store",
      sender_name: contactName || storeName,
      sender_role: null,
      sender_avatar_url: null,
      message_body: message || "ส่งรูปภาพ",
      created_at: new Date().toISOString(),
      attachments: []
    };

    // Optimistic local echo keeps the POS responsive while the message is
    // persisted across projects.
    setMessages((current) => [...current, optimisticMessage]);
    setDraft("");
    setAttachment(null);
    setBusy("send");
    setError("");
    void typingChannelRef.current?.send({ type: "broadcast", event: "typing", payload: { actor: "store", typing: false } });
    void typingChannelRef.current?.send({
      type: "broadcast",
      event: "message_preview",
      payload: {
        actor: "store",
        client_id: optimisticId,
        message: optimisticMessage.message_body,
        created_at: optimisticMessage.created_at,
        name: optimisticMessage.sender_name,
        role: optimisticMessage.sender_role,
        avatar_url: optimisticMessage.sender_avatar_url
      }
    });

    try {
      const response = await fetch(`/api/pos/support-chat/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          attachment: pendingAttachment ? await attachmentPayload(pendingAttachment) : null
        })
      });
      const json = await response.json().catch(() => null) as Envelope<{ message: Message; conversation: Conversation; head: Head }> | null;
      if (response.status === 404) {
        void typingChannelRef.current?.send({
          type: "broadcast",
          event: "message_retract",
          payload: { actor: "store", client_id: optimisticId }
        });
        setMessages((current) => current.filter((item) => item.id !== optimisticId));
        clearGoneConversation(selectedId);
        setError("");
        return;
      }
      if (response.status === 409 && json?.error?.code === "conversation_closed") {
        void typingChannelRef.current?.send({
          type: "broadcast",
          event: "message_retract",
          payload: { actor: "store", client_id: optimisticId }
        });
        setMessages((current) => current.filter((item) => item.id !== optimisticId));
        resetClosedConversation(selectedId);
        return;
      }
      if (!response.ok || !json?.data) throw new Error(json?.error?.message || "ส่งข้อความไม่สำเร็จ");

      setConversation(json.data.conversation);
      setMessages((current) => {
        const withoutOptimistic = current.filter((item) => item.id !== optimisticId);
        if (withoutOptimistic.some((item) => item.id === json.data!.message.id)) return withoutOptimistic;
        return [...withoutOptimistic, json.data!.message];
      });
      setHeads((current) => [json.data!.head, ...current.filter((row) => row.conversation_id !== json.data!.head.conversation_id)]);
    } catch (cause) {
      void typingChannelRef.current?.send({
        type: "broadcast",
        event: "message_retract",
        payload: { actor: "store", client_id: optimisticId }
      });
      setMessages((current) => current.filter((item) => item.id !== optimisticId));
      setDraft((current) => current || message);
      setAttachment((current) => current ?? pendingAttachment);
      setError(cause instanceof Error ? cause.message : "ส่งข้อความไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function closeConversation() {
    if (!selectedId || !window.confirm("จบการสนทนานี้? รูปภาพที่แนบจะถูกลบทันที แต่ข้อความจะยังเก็บไว้")) return;
    setBusy("close");
    setError("");
    try {
      const response = await fetch(`/api/pos/support-chat/conversations/${selectedId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "close" })
      });
      const json = await response.json().catch(() => null) as Envelope<{ conversation: Conversation; head: Head }> | null;
      if (response.status === 404) {
        clearGoneConversation(selectedId);
        setError("");
        return;
      }
      if (!response.ok || !json?.data) throw new Error(json?.error?.message || "จบการสนทนาไม่สำเร็จ");
      setHeads((current) => [json.data!.head, ...current.filter((row) => row.conversation_id !== json.data!.head.conversation_id)]);
      resetClosedConversation(selectedId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "จบการสนทนาไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-3 text-sm font-black text-white shadow-sm transition hover:bg-blue-700">
        <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3 1.7-5A8 8 0 1 1 21 15Z" />
          <path d="M8 10h8M8 14h5" />
        </svg>
        คุยแชท
        {openConversation?.unread_store_count ? <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-blue-700">{openConversation.unread_store_count}</span> : null}
      </button>

      {open ? <div className="fixed inset-0 z-[520] grid place-items-center bg-slate-950/50 p-3 backdrop-blur-[2px]"
        onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false); }}>
        <section role="dialog" aria-modal="true" className="flex h-[min(760px,92vh)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
          <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
            <div className="mr-auto">
              <strong className="text-base text-slate-950">Support Chat</strong>
              <div className="text-xs text-slate-500">{storeCode} · {storeName}</div>
            </div>
            {selectedId ? <button type="button" onClick={() => void loadMessages(selectedId)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">รีเฟรช</button> : null}
            <button type="button" onClick={() => setOpen(false)}
              className="h-9 w-9 rounded-full border border-slate-200 text-xl text-slate-500">×</button>
          </header>

          {error ? <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-700">{error}</div> : null}

          {!selectedId && !openConversation ? (
            <div className="mx-auto grid w-full max-w-xl gap-4 p-5 sm:p-8">
              <div>
                <h3 className="text-xl font-black text-slate-950">เริ่มคุยกับทีม Support</h3>
                <p className="mt-1 text-sm text-slate-500">ส่งข้อมูลรอบแรกเพื่อให้ฝ่าย IT รับเรื่อง</p>
              </div>
              <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                ชื่อเรื่องที่ติดต่อ
                <input value={subject} onChange={(event) => setSubject(event.target.value.slice(0,180))}
                  placeholder="เช่น ระบบขายมีปัญหา / สอบถามแพ็กเกจ"
                  className="rounded-xl border border-slate-300 px-3 py-3 font-normal outline-none focus:border-blue-500" />
              </label>
              <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                รหัสร้าน
                <input value={storeCode} readOnly
                  className="rounded-xl border border-slate-200 bg-slate-100 px-3 py-3 font-mono text-slate-600" />
              </label>
              <label className="grid gap-1.5 text-sm font-bold text-slate-700">
                ชื่อผู้ติดต่อ
                <input value={contactName} onChange={(event) => setContactName(event.target.value.slice(0,120))}
                  placeholder="ชื่อผู้ติดต่อ"
                  className="rounded-xl border border-slate-300 px-3 py-3 font-normal outline-none focus:border-blue-500" />
              </label>
              <button type="button" onClick={() => void createConversation()} disabled={busy !== ""}
                className="rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white disabled:opacity-50">
                {busy === "create" ? "กำลังส่ง..." : "เริ่มสนทนา"}
              </button>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-4 py-3">
                <Avatar src={conversation?.assigned_user_avatar_url} label={conversation?.assigned_user_name || "IT Support"} tone="green" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black text-slate-900">
                    {conversation?.assigned_user_name ? `กำลังดูแลโดย ${conversation.assigned_user_name}` : "รอทีม IT รับเรื่อง"}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {conversation?.assigned_role === "it_admin" ? "IT Admin" : conversation?.assigned_role === "it_support" ? "IT Support" : conversation?.subject || openConversation?.subject}
                  </div>
                </div>
                {conversation?.status !== "closed" ? <button type="button" onClick={() => void closeConversation()}
                  disabled={busy === "close"}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-600">
                  จบการสนทนา
                </button> : null}
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#f7faff] p-4">
                {busy === "messages" && !messages.length ? <div className="text-center text-xs text-slate-500">กำลังโหลด...</div> : null}
                {messages.map((message) => {
                  if (message.sender_type === "system") {
                    return <div key={message.id} className="text-center text-[11px] text-slate-400">{message.message_body}</div>;
                  }
                  const mine = message.sender_type === "store";
                  return <div key={message.id} className={"flex gap-2 " + (mine ? "justify-end" : "justify-start")}>
                    {!mine ? <Avatar src={message.sender_avatar_url || conversation?.assigned_user_avatar_url} label={message.sender_name} tone="green" /> : null}
                    <div className={"max-w-[76%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm " +
                      (mine ? "rounded-br-md bg-blue-600 text-white" : "rounded-bl-md border border-slate-200 bg-white text-slate-800")}>
                      {message.attachments?.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"
                        className="mb-2 block overflow-hidden rounded-xl border border-white/30 bg-white/10">
                        <span className="block h-48 w-64 max-w-full bg-contain bg-center bg-no-repeat"
                          style={{ backgroundImage: `url("${item.url.replace(/["\\]/g, "")}")` }} />
                      </a>)}
                      <div className="whitespace-pre-wrap break-words">{message.message_body}</div>
                      <div className={"mt-1 text-[10px] " + (mine ? "text-blue-100" : "text-slate-400")}>{formatTime(message.created_at)}</div>
                    </div>
                    {mine ? <Avatar src={conversation?.store_logo_url} label={conversation?.store_name || storeName} /> : null}
                  </div>;
                })}
              </div>

              {closingByIT ? (
                <div className="border-t border-amber-200 bg-amber-50 px-4 py-4 text-center">
                  <div className="text-xs font-black text-amber-700">ทีม IT กำลังจบการสนทนา…</div>
                  <div className="mt-1 text-[11px] text-amber-600">ช่องส่งข้อความถูกปิดชั่วคราวเพื่อป้องกันข้อความหลุดระหว่างปิดเคส</div>
                </div>
              ) : conversation?.status === "closed" ? (
                <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-center">
                  <div className="text-xs font-bold text-slate-500">จบการสนทนาแล้ว · ระบบเก็บข้อความไว้ แต่รูปภาพถูกลบแล้ว</div>
                  <button type="button" onClick={() => { setSelectedId(""); setConversation(null); setMessages([]); setDraft(""); setAttachment(null); void loadHeads(); }}
                    className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-xs font-black text-white">เริ่มเรื่องใหม่</button>
                </div>
              ) : (
                <div className="border-t border-slate-200 bg-white p-3">
                  {remoteTyping ? <div className="mb-2 text-[11px] font-bold text-slate-500">{remoteTyping} กำลังพิมพ์…</div> : null}
                  {attachment ? <div className="mb-2 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                    <button type="button" onClick={() => setAttachment(null)} className="font-black">ลบ</button>
                  </div> : null}
                  <div className="flex gap-2">
                    <label className="grid h-[48px] w-[48px] shrink-0 cursor-pointer place-items-center rounded-xl border border-slate-300 bg-white text-lg text-slate-600" title="แนบรูปภาพ">
                      📎
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                        onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} />
                    </label>
                    <textarea value={draft}
                      onChange={(event) => { const value = event.target.value.slice(0,4000); setDraft(value); announceTyping(Boolean(value.trim())); }}
                      onBlur={() => announceTyping(false)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void sendMessage();
                        }
                      }}
                      rows={2} placeholder="พิมพ์ข้อความ..."
                      className="min-h-[48px] flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                    <button type="button" onClick={() => void sendMessage()} disabled={busy === "send" || (!draft.trim() && !attachment)}
                      className="rounded-xl bg-blue-600 px-5 text-sm font-black text-white disabled:opacity-40">
                      {busy === "send" ? "..." : "ส่ง"}
                    </button>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">แนบ JPG/PNG/WEBP ไม่เกิน 2 MB · รูปจะถูกลบทันทีเมื่อจบการสนทนา</div>
                </div>
              )}
            </div>
          )}
        </section>
      </div> : null}
    </>
  );
}
