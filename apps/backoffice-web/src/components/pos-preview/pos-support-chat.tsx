"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";

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

type Message = {
  id: string;
  sender_type: "store" | "it" | "system";
  sender_name: string;
  sender_role: string | null;
  sender_avatar_url: string | null;
  message_body: string;
  created_at: string;
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
    return <Image src={src} alt="" width={36} height={36} className="h-9 w-9 rounded-full border border-slate-200 bg-white object-cover" />;
  }
  return <span className={"flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-black text-white " +
    (tone === "green" ? "bg-emerald-500" : "bg-blue-600")}>{initials(label)}</span>;
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
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const openConversation = useMemo(
    () => heads.find((row) => row.status !== "closed") ?? null,
    [heads]
  );

  const loadHeads = useCallback(async () => {
    setBusy("list");
    setError("");
    try {
      const response = await fetch("/api/pos/support-chat/conversations", { cache: "no-store" });
      const json = await response.json().catch(() => null) as Envelope<{ conversations: Head[] }> | null;
      if (!response.ok || !json?.data) throw new Error(json?.error?.message || "โหลดรายการแชทไม่สำเร็จ");
      setHeads(json.data.conversations);
      const current = json.data.conversations.find((row) => row.status !== "closed");
      if (current && !selectedId) setSelectedId(current.conversation_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดรายการแชทไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }, [selectedId]);

  const loadMessages = useCallback(async (id: string) => {
    if (!id) return;
    setBusy("messages");
    setError("");
    try {
      const response = await fetch(`/api/pos/support-chat/conversations/${id}/messages`, { cache: "no-store" });
      const json = await response.json().catch(() => null) as Envelope<{ conversation: Conversation; messages: Message[] }> | null;
      if (!response.ok || !json?.data) throw new Error(json?.error?.message || "โหลดข้อความไม่สำเร็จ");
      setConversation(json.data.conversation);
      setMessages(json.data.messages);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดข้อความไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadHeads();
  }, [open, loadHeads]);

  useEffect(() => {
    if (!open || !selectedId) return;
    void loadMessages(selectedId);
  }, [open, selectedId, loadMessages]);

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
    if (!selectedId || !message) return;
    setBusy("send");
    setError("");
    try {
      const response = await fetch(`/api/pos/support-chat/conversations/${selectedId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message })
      });
      const json = await response.json().catch(() => null) as Envelope<{ message: Message; conversation: Conversation; head: Head }> | null;
      if (!response.ok || !json?.data) throw new Error(json?.error?.message || "ส่งข้อความไม่สำเร็จ");
      setDraft("");
      setConversation(json.data.conversation);
      setMessages((current) => [...current, json.data!.message]);
      setHeads((current) => [json.data!.head, ...current.filter((row) => row.conversation_id !== json.data!.head.conversation_id)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ส่งข้อความไม่สำเร็จ");
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
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-slate-900">
                    {conversation?.assigned_user_name ? `กำลังดูแลโดย ${conversation.assigned_user_name}` : "รอทีม IT รับเรื่อง"}
                  </div>
                  <div className="truncate text-xs text-slate-500">
                    {conversation?.assigned_role === "it_admin" ? "IT Admin" : conversation?.assigned_role === "it_support" ? "IT Support" : conversation?.subject || openConversation?.subject}
                  </div>
                </div>
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
                      <div className="whitespace-pre-wrap break-words">{message.message_body}</div>
                      <div className={"mt-1 text-[10px] " + (mine ? "text-blue-100" : "text-slate-400")}>{formatTime(message.created_at)}</div>
                    </div>
                    {mine ? <Avatar src={conversation?.store_logo_url} label={conversation?.store_name || storeName} /> : null}
                  </div>;
                })}
              </div>

              {conversation?.status === "closed" ? (
                <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-center text-xs font-bold text-slate-500">การสนทนานี้ปิดแล้ว</div>
              ) : (
                <div className="flex gap-2 border-t border-slate-200 bg-white p-3">
                  <textarea value={draft} onChange={(event) => setDraft(event.target.value.slice(0,4000))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                    rows={2} placeholder="พิมพ์ข้อความ..."
                    className="min-h-[48px] flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                  <button type="button" onClick={() => void sendMessage()} disabled={busy === "send" || !draft.trim()}
                    className="rounded-xl bg-blue-600 px-5 text-sm font-black text-white disabled:opacity-40">
                    {busy === "send" ? "..." : "ส่ง"}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </div> : null}
    </>
  );
}
