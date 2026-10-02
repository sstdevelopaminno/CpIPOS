"use client";

import Link from "next/link";
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Language } from "@/lib/i18n";
import { PosManagerApprovalModal } from "@/components/pos-ui/pos-manager-approval-modal";

type Overview = {
  generated_at: string;
  period: {
    today: string;
    last_30_days_from: string;
    last_30_days_to: string;
  };
  today: {
    net_sales: number;
    gross_sales: number;
    receipts: number;
    average_receipt: number;
    cash: number;
    transfer_qr: number;
    card: number;
    discounts: number;
    tax: number;
    cancelled_count: number;
    top_products: Array<{ product_id: string; name: string; category: string; units: number; revenue: number }>;
  };
  last_30_days: {
    net_sales: number;
    receipts: number;
    average_receipt: number;
    top_products: Array<{ product_id: string; name: string; category: string; units: number; revenue: number }>;
  };
  stock: {
    low_stock_count: number;
    low_stock: Array<{ id: string; name: string; unit: string; quantity_on_hand: number; reorder_level: number }>;
  };
  cost: {
    available: boolean;
    low_margin_products: Array<{
      product_id: string;
      name: string;
      category: string;
      sale_price: number;
      estimated_cost: number;
      gross_profit: number;
      margin_pct: number;
      ingredient_lines: number;
      missing_cost_lines: number;
    }>;
  };
};

type AiQuotaStatus = {
  enabled: boolean;
  source: "package" | "tenant_custom" | "tenant_unlimited";
  month_key: string;
  limits: { requests: number | null; tokens: number | null; cost_usd: number | null };
  usage: { requests: number; total_tokens: number; cost_usd: number };
  exhausted: boolean;
  exhausted_by: Array<"requests" | "tokens" | "cost">;
  addons?: { purchases: number; requests: number; tokens: number; cost_usd: number };
  history_retention_days: number | null;
};

type AiChatRoom = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
};

type AiProposal =
  | {
      id: string;
      type: "update_product_price";
      title: string;
      product_id: string;
      product_name: string;
      current_price: number;
      new_price: number;
      reason: string;
      requires_pin: true;
    }
  | {
      id: string;
      type: "adjust_stock";
      title: string;
      ingredient_id: string;
      ingredient_name: string;
      unit: string;
      current_quantity: number;
      quantity_delta: number;
      reason: string;
      requires_pin: true;
    }
  | {
      id: string;
      type: "marketing_campaign";
      title: string;
      offer: string;
      audience: string;
      channels: string[];
      copy_text: string;
      reason: string;
      requires_pin: false;
    }
  | {
      id: string;
      type: "create_product";
      title: string;
      product_id: string;
      product_name: string;
      category: string;
      stock_quantity: number;
      store_price: number;
      delivery_price: number;
      reason: string;
      requires_pin: true;
    }
  | {
      id: string;
      type: "product_image";
      title: string;
      product_id: string;
      product_name: string;
      prompt: string;
      reason: string;
      requires_pin: false;
    }
  | {
      id: string;
      type: "document";
      title: string;
      category: "general" | "sales" | "stock" | "cost" | "marketing" | "accounting" | "guide";
      content: string;
      reason: string;
      requires_pin: false;
    };

type ProposalStatus = {
  state: "idle" | "executing" | "success" | "error";
  message?: string;
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  proposals?: AiProposal[];
};

type ApiEnvelope<T> = {
  data?: T | null;
  error?: { code?: string; message?: string } | null;
};

const POS_SESSION_AUTH_CODES = new Set([
  "session_expired",
  "session_not_active",
  "session_not_found",
  "missing_pos_session",
  "invalid_handoff_token",
  "session_claim_mismatch",
  "session_user_inactive"
]);

function isPosSessionAuthFailure(status: number, code: unknown) {
  return status === 401 || POS_SESSION_AUTH_CODES.has(String(code ?? "").trim());
}

function redirectToPosLogin() {
  try {
    window.sessionStorage.setItem("cpipos-ai-return-path", "/preview/pos/ai-assistant");
  } catch {
    // Re-authentication must still work if sessionStorage is unavailable.
  }
  window.location.assign("/login/employee");
}

const QUICK_PROMPTS = [
  "สรุปยอดขายวันนี้ให้หน่อย",
  "เมนูไหนกำไรน้อยที่สุด",
  "ช่วยเสนอราคาสินค้าที่มาร์จิ้นต่ำ",
  "มีสินค้าอะไรใกล้หมดบ้าง",
  "ช่วยคิดโปรโมชันเพิ่มยอดขาย",
  "วิเคราะห์สินค้าขายดี 30 วัน"
];

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function friendlyAiError(message: unknown) {
  const text = String(message ?? "").trim();
  if (!text) return "ขออภัย ระบบ CpiPOS AI ขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง";
  if (/session is expired|session_expired|missing_pos_session|session_not_active|session_not_found/i.test(text)) {
    return "เซสชัน POS หมดอายุ กรุณาเข้าสู่ระบบพนักงานอีกครั้ง";
  }
  if (/prompt_cache_key|maximum length 64/i.test(text)) {
    return "ขออภัย ระบบแคชชั่วคราวขัดข้อง กรุณาลองส่งข้อความอีกครั้ง";
  }
  if (/quota|โควตา/i.test(text)) {
    return "โควตา CpiPOS AI ของร้านนี้ครบหรือถูกปิดแล้ว กรุณาตรวจสอบแพ็กเกจหรือติดต่อผู้ดูแลระบบ";
  }
  if (/api key|authorization/i.test(text)) {
    return "CpiPOS AI ยังไม่พร้อมใช้งานชั่วคราว กรุณาติดต่อผู้ดูแลระบบ";
  }
  if (/ข้อความนี้ถูกเก็บไว้ในห้องแชทแล้ว|โควตาบริการ AI ภายนอก/i.test(text)) {
    return text;
  }
  if (/rate[_ -]?limit|too many requests|tokens per min|tpm/i.test(text)) {
    return "ขณะนี้โควตาบริการ AI ภายนอกถึงขีดจำกัดชั่วคราวครับ ข้อความนี้ถูกเก็บไว้ในห้องแชทแล้ว กรุณาลองใหม่ภายหลัง";
  }
  if (/ai_assistant_disabled_by_it|disabled for this store/i.test(text)) {
    return "CpiPOS AI ถูกปิดสำหรับร้านนี้ตามนโยบายของบริษัท";
  }
  return "ขออภัย CpiPOS AI ไม่สามารถตอบได้ในขณะนี้ กรุณาลองใหม่อีกครั้ง";
}

function SparkleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l1.2 3.1L16 7.3l-2.8 1.2L12 12l-1.2-3.5L8 7.3l2.8-1.2L12 3Z" />
      <path d="M5 13l.8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8L5 13Z" />
      <path d="M18 12l.9 2.4L21 15.3l-2.1.9L18 19l-.9-2.8-2.1-.9 2.1-.9L18 12Z" />
    </svg>
  );
}

function MetricCard({ icon, label, value, note, tone = "blue" }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
  tone?: "blue" | "green" | "orange" | "violet";
}) {
  const tones = {
    blue: "border-blue-100 bg-blue-50/70 text-blue-700",
    green: "border-emerald-100 bg-emerald-50/70 text-emerald-700",
    orange: "border-orange-100 bg-orange-50/70 text-orange-700",
    violet: "border-violet-100 bg-violet-50/70 text-violet-700"
  };
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/80 shadow-sm">{icon}</span>
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-600">{label}</p>
          <p className="mt-1 truncate text-xl font-black text-slate-950">{value}</p>
          <p className="mt-1 text-[11px] font-medium text-slate-500">{note}</p>
        </div>
      </div>
    </div>
  );
}

function AiModal({ open, title, subtitle, onClose, children }: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>("button, a, input, textarea, [tabindex]:not([tabindex='-1'])");
    first?.focus();

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>("button, a, input, textarea, [tabindex]:not([tabindex='-1'])"))
        .filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[105] grid place-items-center bg-slate-950/55 p-3 sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={panelRef} className="max-h-[calc(100vh-24px)] w-full max-w-[820px] overflow-y-auto rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-5">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 bg-white/95 pb-3 backdrop-blur">
          <div>
            <h2 className="text-xl font-black text-[#10213d]">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm font-medium text-slate-500">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-lg font-black text-slate-600 hover:bg-slate-50" aria-label="ปิด">×</button>
        </div>
        {children}
      </section>
    </div>
  );
}

function InlineRichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) => part.startsWith("**") && part.endsWith("**")
        ? <strong key={index} className="font-black text-inherit">{part.slice(2, -2)}</strong>
        : <span key={index}>{part}</span>)}
    </>
  );
}

function AiRichText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const nodes: React.ReactNode[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trimEnd();
    const next = lines[index + 1]?.trim() ?? "";
    if (line.includes("|") && /^\|?\s*:?-{3,}/.test(next)) {
      const headers = line.split("|").map((item) => item.trim()).filter(Boolean);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(lines[index].split("|").map((item) => item.trim()).filter(Boolean));
        index += 1;
      }
      index -= 1;
      nodes.push(
        <div key={`table-${index}`} className="my-3 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-slate-50"><tr>{headers.map((cell, cellIndex) => <th key={cellIndex} className="border-b border-slate-200 px-3 py-2 font-semibold text-slate-700"><InlineRichText text={cell} /></th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-2 align-top text-slate-700"><InlineRichText text={cell} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      );
      continue;
    }
    if (!line.trim()) {
      nodes.push(<div key={index} className="h-1" />);
      continue;
    }
    const bullet = line.match(/^[-•]\s+(.+)$/);
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (bullet) {
      nodes.push(<div key={index} className="flex gap-2"><span className="mt-[1px] text-blue-500">•</span><span><InlineRichText text={bullet[1]} /></span></div>);
      continue;
    }
    if (numbered) {
      nodes.push(<div key={index} className="flex gap-2"><span className="font-semibold text-blue-600">{line.match(/^\d+/)?.[0]}.</span><span><InlineRichText text={numbered[1]} /></span></div>);
      continue;
    }
    nodes.push(<p key={index}><InlineRichText text={line} /></p>);
  }
  return <div className="space-y-1.5">{nodes}</div>;
}

function documentCategory(text: string) {
  if (/การตลาด|โปรโมชัน|แคมเปญ|ลูกค้า/.test(text)) return "marketing";
  if (/ต้นทุน|กำไร|margin|มาร์จิ้น/.test(text)) return "cost";
  if (/สต๊อก|วัตถุดิบ|คงเหลือ/.test(text)) return "stock";
  if (/บัญชี|ภาษี|รายรับ|รายจ่าย|ชำระ/.test(text)) return "accounting";
  if (/วิธีใช้|คู่มือ|เมนู|ตั้งค่า|เข้าใช้งาน/.test(text)) return "guide";
  if (/ยอดขาย|ขายดี|บิล/.test(text)) return "sales";
  return "general";
}

function ChatRoomPanel({
  rooms,
  activeRoomId,
  busy,
  todaySales,
  onCreate,
  onOpen,
  onDelete,
  onOpenToday,
  onOpenRecommendations
}: {
  rooms: AiChatRoom[];
  activeRoomId: string | null;
  busy: boolean;
  todaySales: number | null;
  onCreate: () => void;
  onOpen: (roomId: string) => void;
  onDelete: (room: AiChatRoom) => void;
  onOpenToday: () => void;
  onOpenRecommendations: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent text-slate-800">
      <div className="shrink-0 space-y-2 p-3">
        <button
          type="button"
          onClick={onCreate}
          disabled={busy}
          className="flex h-10 w-full items-center gap-2 rounded-xl border border-white/80 bg-white/70 px-3 text-sm font-semibold shadow-sm backdrop-blur transition hover:bg-white disabled:opacity-50"
        >
          <span className="text-lg font-light">＋</span>
          แชทใหม่
        </button>
        <button
          type="button"
          onClick={onOpenToday}
          className="flex min-h-10 w-full items-center justify-between gap-2 rounded-xl border border-white/80 bg-white/65 px-3 text-left text-xs font-semibold text-slate-700 shadow-sm backdrop-blur transition hover:bg-white"
        >
          <span className="inline-flex min-w-0 items-center gap-2"><span aria-hidden>📊</span><span className="truncate">ข้อมูลสำคัญวันนี้</span></span>
          {todaySales != null ? <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">฿{money(todaySales)}</span> : null}
        </button>
        <button
          type="button"
          onClick={onOpenRecommendations}
          className="flex min-h-10 w-full items-center gap-2 rounded-xl border border-white/80 bg-white/65 px-3 text-left text-xs font-semibold text-slate-700 shadow-sm backdrop-blur transition hover:bg-white"
        >
          <span className="text-violet-600"><SparkleIcon size={14} /></span>
          <span className="truncate">เมนูแนะนำสำหรับคุณ</span>
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <p className="px-2 pb-2 pt-1 text-[11px] font-semibold text-slate-400">แชทของฉัน</p>
        <div className="space-y-1">
          {rooms.length ? rooms.map((room) => {
            const active = room.id === activeRoomId;
            return (
              <div key={room.id} className={`group flex items-center rounded-lg transition ${active ? "bg-slate-200/80" : "hover:bg-slate-200/55"}`}>
                <button
                  type="button"
                  onClick={() => onOpen(room.id)}
                  className="min-w-0 flex-1 px-3 py-2.5 text-left"
                >
                  <span className="block truncate text-[13px] font-medium text-slate-800">{room.title}</span>
                  <span className="mt-0.5 block text-[10px] text-slate-400">
                    {new Date(room.last_message_at).toLocaleDateString("th-TH", { day: "numeric", month: "short" })}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(room)}
                  disabled={busy}
                  className="mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 opacity-0 transition hover:bg-white hover:text-red-600 group-hover:opacity-100 focus:opacity-100 disabled:opacity-30"
                  aria-label={`ลบห้อง ${room.title}`}
                  title="ลบห้องแชท"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                    <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
                  </svg>
                </button>
              </div>
            );
          }) : (
            <div className="px-3 py-8 text-center text-xs leading-5 text-slate-400">
              ยังไม่มีห้องแชท<br />กด “แชทใหม่” เพื่อเริ่มต้น
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

function welcomeMessage(lang: Language): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    text: lang === "th"
      ? "สวัสดีครับ ผมคือ CpiPOS AI 👋\nผมช่วยสรุปยอดขาย วิเคราะห์ต้นทุนและสต๊อก พร้อมช่วยคิดการตลาดจากข้อมูลจริงของร้านได้ครับ"
      : "Hello, I’m CpiPOS AI 👋\nI can summarize sales, analyze cost and stock, and help with marketing using your store data."
  };
}

export function CpiPosAiAssistant({ lang }: { lang: Language }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [quota, setQuota] = useState<AiQuotaStatus | null>(null);
  const [quotaPopupOpen, setQuotaPopupOpen] = useState(false);
  const quotaPopupKeyRef = useRef("");
  const [input, setInput] = useState("");
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingProposal, setPendingProposal] = useState<AiProposal | null>(null);
  const [proposalStatus, setProposalStatus] = useState<Record<string, ProposalStatus>>({});
  const [generatedProductImages, setGeneratedProductImages] = useState<Record<string, string>>({});
  const [todayModalOpen, setTodayModalOpen] = useState(false);
  const [recommendationModalOpen, setRecommendationModalOpen] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [rooms, setRooms] = useState<AiChatRoom[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [roomDrawerOpen, setRoomDrawerOpen] = useState(false);
  const [roomSidebarCollapsed, setRoomSidebarCollapsed] = useState(false);
  const [roomBusy, setRoomBusy] = useState(false);
  const [documentBusyId, setDocumentBusyId] = useState<string | null>(null);
  const [documentNotice, setDocumentNotice] = useState<Record<string,string>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage(lang)]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activeRoom = useMemo(() => rooms.find((room) => room.id === activeRoomId) ?? null, [rooms, activeRoomId]);
  const visibleMessages = useMemo(() => messages.filter((message) => message.id !== "welcome"), [messages]);
  const hasConversation = visibleMessages.some((message) => message.role === "user");
  const lowMargin = overview?.cost.low_margin_products?.[0] ?? null;
  const bestSeller = overview?.today.top_products?.[0] ?? overview?.last_30_days.top_products?.[0] ?? null;

  function rememberActiveRoom(roomId: string | null) {
    try {
      if (roomId) window.localStorage.setItem("cpipos-ai-active-room-id", roomId);
      else window.localStorage.removeItem("cpipos-ai-active-room-id");
    } catch {
      // Restoring the active room is a convenience only.
    }
  }

  function toggleRoomSidebar() {
    setRoomSidebarCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("cpipos-ai-room-sidebar-collapsed", next ? "1" : "0");
      } catch {
        // Local preference is optional.
      }
      return next;
    });
  }

  const updatedLabel = useMemo(() => {
    if (!overview?.generated_at) return "-";
    const date = new Date(overview.generated_at);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("th-TH", {
      timeZone: "Asia/Bangkok",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }, [overview?.generated_at]);

  useEffect(() => {
    if (!quota?.exhausted) return;
    const key = `${quota.month_key}:${quota.exhausted_by.join(",")}:${quota.usage.requests}:${quota.usage.total_tokens}`;
    if (quotaPopupKeyRef.current === key) return;
    quotaPopupKeyRef.current = key;
    setQuotaPopupOpen(true);
  }, [quota?.exhausted, quota?.month_key, quota?.usage.requests, quota?.usage.total_tokens, quota?.exhausted_by]);

  useEffect(() => {
    let cancelled = false;
    async function loadOverview() {
      setOverviewLoading(true);
      setOverviewError(null);
      try {
        let preferredRoomId = "";
        try {
          preferredRoomId = window.localStorage.getItem("cpipos-ai-active-room-id") ?? "";
        } catch {
          // A missing local preference should not block AI startup.
        }
        const initialUrl = preferredRoomId
          ? `/api/pos/ai/assistant?room_id=${encodeURIComponent(preferredRoomId)}`
          : "/api/pos/ai/assistant";
        const response = await fetch(initialUrl, { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as ApiEnvelope<{ overview?: Overview; rooms?: AiChatRoom[]; active_room?: AiChatRoom | null; history?: ChatMessage[]; history_warning?: string | null; quota?: AiQuotaStatus }>;
        if (isPosSessionAuthFailure(response.status, body?.error?.code)) {
          redirectToPosLogin();
          return;
        }
        if (!response.ok) throw new Error(body?.error?.message ?? "ไม่สามารถโหลดข้อมูลร้านได้");
        if (!cancelled) {
          setOverview(body?.data?.overview ?? null);
          setQuota(body?.data?.quota ?? null);
          const loadedRooms = Array.isArray(body?.data?.rooms) ? body.data.rooms : [];
          const loadedActiveRoom = body?.data?.active_room ?? loadedRooms[0] ?? null;
          setRooms(loadedRooms);
          setActiveRoomId(loadedActiveRoom?.id ?? null);
          rememberActiveRoom(loadedActiveRoom?.id ?? null);
          const storedHistory = Array.isArray(body?.data?.history)
            ? body.data.history.filter((message) => message.role === "user" || message.role === "assistant")
            : [];
          const historyWarning = String(body?.data?.history_warning ?? "").trim();
          setMessages(
            storedHistory.length
              ? storedHistory
              : historyWarning
                ? [{ id: "history-warning", role: "assistant", text: historyWarning }]
                : [welcomeMessage(lang)]
          );
        }
      } catch (error) {
        if (!cancelled) setOverviewError(friendlyAiError(error instanceof Error ? error.message : error));
      } finally {
        if (!cancelled) setOverviewLoading(false);
      }
    }
    void loadOverview();
    return () => {
      cancelled = true;
    };
  }, []);

  async function openRoom(roomId: string) {
    if (roomBusy || roomId === activeRoomId) {
      setRoomDrawerOpen(false);
      return;
    }
    setRoomBusy(true);
    setOverviewError(null);
    try {
      const response = await fetch(`/api/pos/ai/conversations/${encodeURIComponent(roomId)}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<{ room?: AiChatRoom; messages?: ChatMessage[]; history_warning?: string | null }>;
      if (isPosSessionAuthFailure(response.status, body?.error?.code)) {
        redirectToPosLogin();
        return;
      }
      if (!response.ok || !body?.data?.room) throw new Error(body?.error?.message ?? "ไม่สามารถเปิดห้องแชทได้");
      setActiveRoomId(body.data.room.id);
      rememberActiveRoom(body.data.room.id);
      const roomMessages = Array.isArray(body.data.messages) ? body.data.messages : [];
      const historyWarning = String(body.data.history_warning ?? "").trim();
      setMessages(
        roomMessages.length
          ? roomMessages
          : historyWarning
            ? [{ id: "history-warning", role: "assistant", text: historyWarning }]
            : [welcomeMessage(lang)]
      );
      setProposalStatus({});
      setAutoScroll(true);
      setRoomDrawerOpen(false);
      requestAnimationFrame(() => scrollToBottom("auto"));
    } catch (error) {
      setOverviewError(friendlyAiError(error instanceof Error ? error.message : error));
    } finally {
      setRoomBusy(false);
    }
  }

  async function createRoom() {
    if (roomBusy || sending || quota?.enabled === false) return;
    setRoomBusy(true);
    setOverviewError(null);
    try {
      const response = await fetch("/api/pos/ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "แชทใหม่" })
      });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<{ room?: AiChatRoom }>;
      if (isPosSessionAuthFailure(response.status, body?.error?.code)) {
        redirectToPosLogin();
        return;
      }
      if (!response.ok || !body?.data?.room) throw new Error(body?.error?.message ?? "สร้างห้องแชทไม่สำเร็จ");
      const room = body.data.room;
      setRooms((current) => [room, ...current.filter((item) => item.id !== room.id)]);
      setActiveRoomId(room.id);
      rememberActiveRoom(room.id);
      setMessages([welcomeMessage(lang)]);
      setProposalStatus({});
      setRoomDrawerOpen(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (error) {
      setOverviewError(friendlyAiError(error instanceof Error ? error.message : error));
    } finally {
      setRoomBusy(false);
    }
  }

  async function deleteRoom(room: AiChatRoom) {
    if (roomBusy || sending) return;
    if (!window.confirm(`ลบห้องแชท “${room.title}” หรือไม่?\n\nข้อความในห้องนี้จะถูกลบถาวรและไม่สามารถกู้คืนได้`)) return;
    setRoomBusy(true);
    setOverviewError(null);
    try {
      const response = await fetch(`/api/pos/ai/conversations/${encodeURIComponent(room.id)}`, { method: "DELETE" });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<{ deleted?: boolean }>;
      if (isPosSessionAuthFailure(response.status, body?.error?.code)) {
        redirectToPosLogin();
        return;
      }
      if (!response.ok) throw new Error(body?.error?.message ?? "ลบห้องแชทไม่สำเร็จ");
      const remaining = rooms.filter((item) => item.id !== room.id);
      setRooms(remaining);
      if (activeRoomId === room.id) {
        const nextRoom = remaining[0] ?? null;
        setActiveRoomId(nextRoom?.id ?? null);
        rememberActiveRoom(nextRoom?.id ?? null);
        if (nextRoom) {
          setRoomBusy(false);
          await openRoom(nextRoom.id);
          return;
        }
        setMessages([welcomeMessage(lang)]);
      }
    } catch (error) {
      setOverviewError(friendlyAiError(error instanceof Error ? error.message : error));
    } finally {
      setRoomBusy(false);
    }
  }

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("cpipos-ai-show-suggestions");
      if (saved === "0") setShowSuggestions(false);
      if (saved === "1") setShowSuggestions(true);
      setRoomSidebarCollapsed(window.localStorage.getItem("cpipos-ai-room-sidebar-collapsed") === "1");
    } catch {
      // Local preference is optional.
    }
  }, []);

  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    const container = chatScrollRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
  }

  function handleChatScroll() {
    const container = chatScrollRef.current;
    if (!container) return;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    const nearBottom = distance < 120;
    setAutoScroll(nearBottom);
    setShowScrollToBottom(!nearBottom);
  }

  function toggleSuggestions() {
    setShowSuggestions((current) => {
      const next = !current;
      try {
        window.localStorage.setItem("cpipos-ai-show-suggestions", next ? "1" : "0");
      } catch {
        // Local preference is optional.
      }
      return next;
    });
  }

  function resizeComposer(target: HTMLTextAreaElement) {
    target.style.height = "auto";
    target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
  }

  useEffect(() => {
    if (!autoScroll) return;
    requestAnimationFrame(() => scrollToBottom(sending ? "auto" : "smooth"));
  }, [messages, sending, autoScroll]);

  function attachImage(file: File | null) {
    if (!file) return;
    if (!["image/jpeg","image/png","image/webp"].includes(file.type)) {
      setOverviewError("รองรับเฉพาะรูป JPEG, PNG หรือ WebP");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setOverviewError("รูปภาพต้องมีขนาดไม่เกิน 2 MB เพื่อควบคุมความเร็วและค่าใช้ AI");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : null;
      setImageDataUrl(value);
      setImageName(file.name);
      setOverviewError(null);
      requestAnimationFrame(() => textareaRef.current?.focus());
    };
    reader.onerror = () => setOverviewError("อ่านรูปภาพไม่สำเร็จ");
    reader.readAsDataURL(file);
  }

  async function sendMessage(prompt?: string) {
    const messageText = String(prompt ?? input).trim();
    if ((!messageText && !imageDataUrl) || sending || quota?.exhausted || quota?.enabled === false) return;
    const displayedText = messageText || "ช่วยอ่านรูปภาพนี้ให้หน่อย";
    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: imageName ? `${displayedText}\n📎 ${imageName}` : displayedText
    };
    setAutoScroll(true);
    setShowScrollToBottom(false);
    setMessages((current) => [...current, userMessage]);
    setInput("");
    const attachedImage = imageDataUrl;
    setImageDataUrl(null);
    setImageName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setSending(true);
    requestAnimationFrame(() => scrollToBottom("smooth"));

    try {
      const response = await fetch("/api/pos/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: messageText, room_id: activeRoomId, image_data_url: attachedImage })
      });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<{ answer?: string; overview?: Overview; room?: AiChatRoom; proposals?: AiProposal[]; quota?: AiQuotaStatus }>;
      if (isPosSessionAuthFailure(response.status, body?.error?.code)) {
        setMessages((current) => [...current, {
          id: `assistant-session-${Date.now()}`,
          role: "assistant",
          text: "เซสชัน POS หมดอายุ กำลังพาไปเข้าสู่ระบบพนักงานอีกครั้ง..."
        }]);
        window.setTimeout(redirectToPosLogin, 450);
        return;
      }
      if (!response.ok) throw new Error(body?.error?.message ?? "CpiPOS AI ไม่สามารถตอบได้ในขณะนี้");

      if (body?.data?.overview) setOverview(body.data.overview);
      if (body?.data?.quota) setQuota(body.data.quota);
      if (body?.data?.room) {
        const room = body.data.room;
        setActiveRoomId(room.id);
        rememberActiveRoom(room.id);
        setRooms((current) => [room, ...current.filter((item) => item.id !== room.id)]);
      }
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: String(body?.data?.answer ?? "ยังไม่มีคำตอบจาก CpiPOS AI"),
          proposals: Array.isArray(body?.data?.proposals) ? body.data.proposals : []
        }
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `assistant-error-${Date.now()}`,
          role: "assistant",
          text: friendlyAiError(error instanceof Error ? error.message : error)
        }
      ]);
    } finally {
      setSending(false);
    }
  }

  async function clearHistory() {
    if (!window.confirm("ล้างประวัติ CpiPOS AI ของบัญชีผู้ใช้นี้ในสาขานี้ทั้งหมดหรือไม่?\n\nประวัติของ Owner/Manager คนอื่นจะไม่ถูกลบ")) return;
    setSending(true);
    try {
      const response = await fetch("/api/pos/ai/assistant", { method: "DELETE" });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<{ cleared?: boolean }>;
      if (isPosSessionAuthFailure(response.status, body?.error?.code)) {
        redirectToPosLogin();
        return;
      }
      if (!response.ok) throw new Error(body?.error?.message ?? "ไม่สามารถล้างประวัติ CpiPOS AI ได้");
      setMessages([welcomeMessage(lang)]);
      setRooms([]);
      setActiveRoomId(null);
      rememberActiveRoom(null);
      setProposalStatus({});
    } catch (error) {
      setMessages((current) => [...current, {
        id: `history-error-${Date.now()}`,
        role: "assistant",
        text: friendlyAiError(error instanceof Error ? error.message : error)
      }]);
    } finally {
      setSending(false);
    }
  }

  async function refreshOverview() {
    try {
      const response = await fetch("/api/pos/ai/assistant", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<{ overview?: Overview; quota?: AiQuotaStatus }>;
      if (response.ok && body?.data?.overview) setOverview(body.data.overview);
      if (response.ok && body?.data?.quota) setQuota(body.data.quota);
    } catch {
      // Keep the confirmed action result visible even if the dashboard refresh fails.
    }
  }

  function requestExecution(proposal: AiProposal) {
    if (!proposal.requires_pin) return;
    const detail = proposal.type === "update_product_price"
      ? `${proposal.product_name}: ฿${money(proposal.current_price)} → ฿${money(proposal.new_price)}`
      : proposal.type === "create_product"
        ? `${proposal.product_name} · ${proposal.category} · สต๊อก ${money(proposal.stock_quantity)} · หน้าร้าน ฿${money(proposal.store_price)} · เดลิเวอรี่ ฿${money(proposal.delivery_price)}`
        : `${proposal.ingredient_name}: ${money(proposal.quantity_delta)} ${proposal.unit}`;
    if (!window.confirm(`ยืนยันรายการที่ CpiPOS AI เตรียมไว้?\n\n${detail}\n\nกรอก PIN Owner/Manager เพื่อยืนยันการเปลี่ยนข้อมูลจริง`)) return;
    setPendingProposal(proposal);
  }

  async function executeProposal(proposal: AiProposal, approvalId: string) {
    if (!proposal.requires_pin) return;
    setProposalStatus((current) => ({ ...current, [proposal.id]: { state: "executing", message: "กำลังดำเนินการ..." } }));
    try {
      const payload = proposal.type === "update_product_price"
        ? {
            action: "update_product_price",
            product_id: proposal.product_id,
            new_price: proposal.new_price,
            reason: proposal.reason,
            approval_id: approvalId
          }
        : proposal.type === "create_product"
          ? {
              action: "create_product",
              product_id: proposal.product_id,
              name: proposal.product_name,
              category: proposal.category,
              stock_quantity: proposal.stock_quantity,
              store_price: proposal.store_price,
              delivery_price: proposal.delivery_price,
              reason: proposal.reason,
              approval_id: approvalId
            }
          : {
              action: "adjust_stock",
              ingredient_id: proposal.ingredient_id,
              quantity_delta: proposal.quantity_delta,
              reason: proposal.reason,
              approval_id: approvalId
            };
      const response = await fetch("/api/pos/ai/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-idempotency-key": `cpipos-ai-${proposal.id}`
        },
        body: JSON.stringify(payload)
      });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<Record<string, unknown>>;
      if (!response.ok) throw new Error(body?.error?.message ?? "ไม่สามารถดำเนินการได้");

      const successText = proposal.type === "update_product_price"
        ? `ปรับราคาหน้าร้าน ${proposal.product_name} เป็น ฿${money(proposal.new_price)} เรียบร้อยแล้ว`
        : proposal.type === "create_product"
          ? `เพิ่มสินค้า ${proposal.product_name} พร้อมสต๊อกและราคาเรียบร้อยแล้ว`
          : `ปรับสต๊อก ${proposal.ingredient_name} ${proposal.quantity_delta > 0 ? "+" : ""}${money(proposal.quantity_delta)} ${proposal.unit} เรียบร้อยแล้ว`;
      setProposalStatus((current) => ({ ...current, [proposal.id]: { state: "success", message: successText } }));
      setMessages((current) => [...current, {
        id: `assistant-action-${Date.now()}`,
        role: "assistant",
        text: `✅ ${successText}\nระบบบันทึก Audit Log ของรายการนี้แล้ว`
      }]);
      await refreshOverview();
    } catch (error) {
      setProposalStatus((current) => ({
        ...current,
        [proposal.id]: { state: "error", message: error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ" }
      }));
    } finally {
      setPendingProposal(null);
    }
  }

  async function copyMarketing(proposal: Extract<AiProposal, { type: "marketing_campaign" }>) {
    try {
      await navigator.clipboard.writeText(proposal.copy_text);
      setProposalStatus((current) => ({ ...current, [proposal.id]: { state: "success", message: "คัดลอกข้อความการตลาดแล้ว" } }));
    } catch {
      setProposalStatus((current) => ({ ...current, [proposal.id]: { state: "error", message: "คัดลอกไม่สำเร็จ กรุณาเลือกข้อความด้วยตนเอง" } }));
    }
  }

  async function saveDocumentProposal(proposal: Extract<AiProposal, { type: "document" }>) {
    setProposalStatus((current) => ({ ...current, [proposal.id]: { state: "executing", message: "กำลังสร้างเอกสาร..." } }));
    try {
      const response = await fetch("/api/pos/ai/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: proposal.title,
          category: proposal.category,
          content: proposal.content,
          room_id: activeRoomId,
          source_message_id: proposal.id
        })
      });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<{ document?: { id: string } }>;
      if (!response.ok || !body?.data?.document?.id) throw new Error(body?.error?.message ?? "สร้างเอกสารไม่สำเร็จ");
      setProposalStatus((current) => ({
        ...current,
        [proposal.id]: { state: "success", message: "สร้างไฟล์เอกสารแล้ว · เปิดได้ที่เมนูเก็บไฟล์เอกสาร" }
      }));
    } catch (error) {
      setProposalStatus((current) => ({
        ...current,
        [proposal.id]: { state: "error", message: error instanceof Error ? error.message : "สร้างเอกสารไม่สำเร็จ" }
      }));
    }
  }

  async function generateProductImage(proposal: Extract<AiProposal, { type: "product_image" }>) {
    setProposalStatus((current) => ({ ...current, [proposal.id]: { state: "executing", message: "กำลังสร้างภาพสินค้า..." } }));
    try {
      const response = await fetch("/api/pos/ai/product-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: proposal.product_id, prompt: proposal.prompt })
      });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<{ image_data_url?: string }>;
      if (!response.ok || !body?.data?.image_data_url) throw new Error(body?.error?.message ?? "สร้างภาพสินค้าไม่สำเร็จ");
      setGeneratedProductImages((current) => ({ ...current, [proposal.id]: body.data!.image_data_url! }));
      setProposalStatus((current) => ({
        ...current,
        [proposal.id]: { state: "success", message: "สร้างภาพสินค้าแล้ว · ตรวจสอบภาพก่อนกดใช้กับสินค้า" }
      }));
    } catch (error) {
      setProposalStatus((current) => ({
        ...current,
        [proposal.id]: { state: "error", message: error instanceof Error ? error.message : "สร้างภาพสินค้าไม่สำเร็จ" }
      }));
    }
  }

  async function imageDataUrlToWebpFile(dataUrl: string, size: number, name: string, quality: number) {
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("อ่านภาพที่สร้างไม่สำเร็จ"));
    });
    image.src = dataUrl;
    await loaded;

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("เบราว์เซอร์ไม่รองรับการเตรียมรูปสินค้า");

    const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
    if (!blob) throw new Error("แปลงรูปสินค้าไม่สำเร็จ");
    return new File([blob], name, { type: "image/webp" });
  }

  async function attachGeneratedProductImage(proposal: Extract<AiProposal, { type: "product_image" }>) {
    const imageDataUrl = generatedProductImages[proposal.id];
    if (!imageDataUrl) return;
    if (!window.confirm(`ใช้ภาพที่สร้างเป็นรูปสินค้า “${proposal.product_name}” ในระบบ POS หรือไม่?`)) return;

    setProposalStatus((current) => ({ ...current, [proposal.id]: { state: "executing", message: "กำลังบันทึกรูปสินค้า..." } }));
    try {
      const [display, thumbnail] = await Promise.all([
        imageDataUrlToWebpFile(imageDataUrl, 1024, `${proposal.product_name}-display.webp`, 0.84),
        imageDataUrlToWebpFile(imageDataUrl, 400, `${proposal.product_name}-thumb.webp`, 0.76)
      ]);
      const form = new FormData();
      form.set("display", display);
      form.set("thumbnail", thumbnail);
      form.set("display_width", "1024");
      form.set("display_height", "1024");
      form.set("thumbnail_width", "400");
      form.set("thumbnail_height", "400");

      const response = await fetch(`/api/pos/product-media/${encodeURIComponent(proposal.product_id)}`, {
        method: "POST",
        body: form
      });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<Record<string, unknown>>;
      if (!response.ok) throw new Error(body?.error?.message ?? "บันทึกรูปสินค้าไม่สำเร็จ");
      setProposalStatus((current) => ({
        ...current,
        [proposal.id]: { state: "success", message: "บันทึกรูปสินค้าเข้าเมนูจัดการสินค้าแล้ว" }
      }));
    } catch (error) {
      setProposalStatus((current) => ({
        ...current,
        [proposal.id]: { state: "error", message: error instanceof Error ? error.message : "บันทึกรูปสินค้าไม่สำเร็จ" }
      }));
    }
  }

  async function saveMessageAsDocument(message: ChatMessage) {
    if (message.role !== "assistant" || message.id === "welcome" || !message.text.trim()) return;
    setDocumentBusyId(message.id);
    try {
      const titleBase = activeRoom?.title && activeRoom.title !== "แชทใหม่" ? activeRoom.title : "เอกสารจาก CpiPOS AI";
      const response = await fetch("/api/pos/ai/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: titleBase,
          category: documentCategory(message.text),
          content: message.text,
          room_id: activeRoomId,
          source_message_id: message.id
        })
      });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<{ document?: { id: string } }>;
      if (!response.ok) throw new Error(body?.error?.message ?? "บันทึกเอกสารไม่สำเร็จ");
      setDocumentNotice((current) => ({ ...current, [message.id]: "บันทึกแล้ว" }));
    } catch (error) {
      setDocumentNotice((current) => ({ ...current, [message.id]: error instanceof Error ? error.message : "บันทึกไม่สำเร็จ" }));
    } finally {
      setDocumentBusyId(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  return (
    <main
      className="h-full min-h-0 w-full overflow-hidden bg-[radial-gradient(circle_at_76%_6%,rgba(56,189,248,0.18),transparent_28%),radial-gradient(circle_at_42%_24%,rgba(59,130,246,0.11),transparent_34%),linear-gradient(180deg,#f7fbff_0%,#f4f8fd_52%,#f8fafc_100%)]"
      style={{ fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans Thai", Tahoma, sans-serif' }}
    >
      <section className="mx-auto flex h-full min-h-0 w-full max-w-[1600px] flex-col">
        <header className="shrink-0 border-b border-white/70 bg-white/35 px-4 py-3 backdrop-blur-xl sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleRoomSidebar}
                className="hidden h-9 w-9 items-center justify-center rounded-xl border border-white/90 bg-white/70 text-slate-500 shadow-sm transition hover:bg-white hover:text-blue-700 lg:inline-flex"
                aria-label={roomSidebarCollapsed ? "เปิดแถบห้องแชท" : "ซ่อนแถบห้องแชท"}
                title={roomSidebarCollapsed ? "เปิดแถบห้องแชท" : "ซ่อนแถบห้องแชท"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {roomSidebarCollapsed ? <path d="m9 18 6-6-6-6" /> : <path d="m15 18-6-6 6-6" />}
                </svg>
              </button>
              <h1 className="text-xl font-semibold tracking-[-0.03em] text-slate-950 sm:text-[26px]">CpiPOS AI</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {quota ? (
                <button type="button" onClick={() => quota.exhausted && setQuotaPopupOpen(true)}
                  className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold backdrop-blur ${quota.exhausted ? "cursor-pointer border-red-200 bg-red-50/90 text-red-700" : "cursor-default border-emerald-200 bg-emerald-50/90 text-emerald-700"}`}>
                  เดือน {quota.month_key}: {quota.usage.requests}{quota.limits.requests ? `/${quota.limits.requests}` : ""} ครั้ง · {new Intl.NumberFormat("th-TH").format(quota.usage.total_tokens)} tokens
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void clearHistory()}
                disabled={sending}
                className="rounded-full border border-white/90 bg-white/70 px-3 py-1.5 text-[10px] font-semibold text-slate-500 shadow-sm transition hover:text-red-600 disabled:opacity-50"
              >
                ล้างประวัติของฉัน
              </button>
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className={`hidden shrink-0 overflow-hidden bg-white/42 backdrop-blur-xl transition-[width,opacity,border-color] duration-200 lg:block ${roomSidebarCollapsed ? "lg:w-0 lg:border-r-0 lg:opacity-0 lg:pointer-events-none" : "lg:w-[270px] lg:border-r lg:border-white/80 lg:opacity-100"}`}>
            <ChatRoomPanel
              rooms={rooms}
              activeRoomId={activeRoomId}
              busy={roomBusy || sending}
              todaySales={overview?.today.net_sales ?? null}
              onCreate={() => void createRoom()}
              onOpen={(roomId) => void openRoom(roomId)}
              onDelete={(room) => void deleteRoom(room)}
              onOpenToday={() => setTodayModalOpen(true)}
              onOpenRecommendations={() => setRecommendationModalOpen(true)}
            />
          </aside>
          <div className="min-h-0 min-w-0 flex-1 bg-white/20">
          <section className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-white/70 bg-white/30 px-4 py-3 backdrop-blur-lg sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRoomDrawerOpen(true)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-600 lg:hidden"
                >
                  ☰ ห้องแชท
                </button>
                <span className="max-w-[260px] truncate text-sm font-semibold text-slate-800">{activeRoom?.title ?? "แชทใหม่"}</span>
                <span className="rounded-full bg-white/70 px-2.5 py-1 text-[10px] font-semibold text-blue-700">ถามเป็นภาษาไทยได้เลย</span>
                <button
                  type="button"
                  onClick={toggleSuggestions}
                  className="ml-auto inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 transition hover:border-blue-200 hover:text-blue-700"
                  aria-expanded={showSuggestions}
                >
                  {showSuggestions ? "ซ่อนคำถามแนะนำ" : "แสดงคำถามแนะนำ"}
                  <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor" aria-hidden className={`transition-transform ${showSuggestions ? "rotate-180" : ""}`}>
                    <path d="M5.5 7.5 10 12l4.5-4.5" />
                  </svg>
                </button>
              </div>
              {showSuggestions ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void sendMessage(prompt)}
                      disabled={sending || quota?.exhausted || quota?.enabled === false}
                      className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-wait disabled:opacity-50"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="relative min-h-0 flex-1">
              <div
                ref={chatScrollRef}
                onScroll={handleChatScroll}
                className="h-full min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6"
              >
              {!hasConversation ? (
                <div className="mx-auto flex min-h-full max-w-[820px] flex-col items-center justify-center px-4 pb-24 text-center">
                  <img src="/brand/cpipos-symbol-transparent.png" alt="" className="h-20 w-20 object-contain drop-shadow-[0_10px_24px_rgba(37,99,235,0.18)] sm:h-24 sm:w-24" />
                  <h2 className="mt-5 text-2xl font-semibold tracking-[-0.03em] text-slate-900">วันนี้อยากให้ CpiPOS AI ช่วยอะไร</h2>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">ถามยอดขาย ต้นทุน สต๊อก บัญชี การตลาด หรือวิธีใช้งาน CpiPOS ได้เลย</p>
                  <div className="mt-5 flex max-w-[760px] flex-wrap justify-center gap-2">
                    {QUICK_PROMPTS.slice(0,4).map((prompt) => (
                      <button key={prompt} type="button" onClick={() => void sendMessage(prompt)} disabled={sending || quota?.exhausted || quota?.enabled === false} className="rounded-full border border-white/90 bg-white/65 px-3 py-2 text-xs font-medium text-slate-700 shadow-sm backdrop-blur transition hover:bg-white disabled:opacity-50">{prompt}</button>
                    ))}
                  </div>
                </div>
              ) : null}
              {visibleMessages.map((message) => (
                <div key={message.id} className="w-full py-2.5 sm:py-3.5">
                  <div className={`mx-auto flex w-full max-w-[820px] ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`${message.role === "user" ? "max-w-[78%] rounded-[24px] bg-white/78 px-4 py-2.5 text-slate-900 shadow-sm backdrop-blur" : "w-full px-1 py-2 text-slate-800"} text-[15px] font-normal leading-7 sm:text-[15.5px]`}>
                      <AiRichText text={message.text} />
                      {message.role === "assistant" ? (
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                          <button type="button" onClick={() => void saveMessageAsDocument(message)} disabled={documentBusyId === message.id} className="rounded-lg px-2 py-1 font-medium transition hover:bg-white/70 hover:text-blue-700 disabled:opacity-50">
                            {documentBusyId === message.id ? "กำลังบันทึก..." : "บันทึกเป็นเอกสาร"}
                          </button>
                          {documentNotice[message.id] ? <span className="text-slate-500">{documentNotice[message.id]}</span> : null}
                        </div>
                      ) : null}
                    {message.role === "assistant" && message.proposals?.length ? (
                      <div className="mt-2 grid gap-2">
                        {message.proposals.map((proposal) => {
                          const status = proposalStatus[proposal.id] ?? { state: "idle" as const };
                          if (proposal.type === "marketing_campaign") {
                            return (
                              <div key={proposal.id} className="rounded-2xl border border-violet-200 bg-violet-50/60 p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <strong className="text-sm font-black text-violet-900">{proposal.title}</strong>
                                  <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-black text-white">MARKETING</span>
                                </div>
                                <p className="mt-1 text-xs font-semibold text-violet-700">{proposal.offer}</p>
                                <p className="mt-2 whitespace-pre-wrap rounded-xl bg-white/80 p-3 text-xs leading-5 text-slate-700">{proposal.copy_text}</p>
                                <p className="mt-2 text-[11px] text-slate-500">กลุ่มเป้าหมาย: {proposal.audience || "-"}{proposal.channels.length ? ` · ช่องทาง: ${proposal.channels.join(", ")}` : ""}</p>
                                <div className="mt-3 flex items-center gap-2">
                                  <button type="button" onClick={() => void copyMarketing(proposal)} className="rounded-xl bg-violet-600 px-3 py-2 text-xs font-black text-white">คัดลอกข้อความ</button>
                                  {status.message ? <span className={`text-[11px] font-bold ${status.state === "error" ? "text-red-600" : "text-emerald-600"}`}>{status.message}</span> : null}
                                </div>
                              </div>
                            );
                          }

                          if (proposal.type === "document") {
                            return (
                              <div key={proposal.id} className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <strong className="text-sm font-black text-emerald-950">{proposal.title}</strong>
                                  <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-black text-white">DOCUMENT</span>
                                </div>
                                <p className="mt-2 max-h-40 overflow-hidden whitespace-pre-wrap rounded-xl bg-white/80 p-3 text-xs leading-5 text-slate-700">{proposal.content}</p>
                                <p className="mt-2 text-[11px] text-slate-500">{proposal.reason}</p>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  <button type="button" onClick={() => void saveDocumentProposal(proposal)}
                                    disabled={status.state === "executing" || status.state === "success"}
                                    className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">
                                    {status.state === "executing" ? "กำลังสร้างไฟล์..." : status.state === "success" ? "สร้างไฟล์แล้ว" : "สร้างไฟล์เอกสาร"}
                                  </button>
                                  {status.message ? <span className={`text-[11px] font-bold ${status.state === "error" ? "text-red-600" : "text-emerald-600"}`}>{status.message}</span> : null}
                                </div>
                              </div>
                            );
                          }

                          if (proposal.type === "product_image") {
                            const generatedImage = generatedProductImages[proposal.id];
                            return (
                              <div key={proposal.id} className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50/60 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <strong className="text-sm font-black text-fuchsia-950">{proposal.title}</strong>
                                  <span className="rounded-full bg-fuchsia-600 px-2 py-0.5 text-[10px] font-black text-white">IMAGE</span>
                                </div>
                                <p className="mt-2 text-xs leading-5 text-slate-600">{proposal.reason}</p>
                                {generatedImage ? <img src={generatedImage} alt={proposal.product_name}
                                  className="mt-3 aspect-square w-full max-w-[360px] rounded-2xl border border-white object-cover shadow-sm" /> :
                                  <p className="mt-2 rounded-xl bg-white/80 p-3 text-xs leading-5 text-slate-600">{proposal.prompt}</p>}
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                  <button type="button" onClick={() => void generateProductImage(proposal)}
                                    disabled={status.state === "executing"}
                                    className="rounded-xl bg-fuchsia-600 px-3 py-2 text-xs font-black text-white disabled:opacity-50">
                                    {status.state === "executing" ? "กำลังสร้างภาพ..." : generatedImage ? "สร้างภาพใหม่" : "สร้างภาพสินค้า"}
                                  </button>
                                  {generatedImage ? <button type="button" onClick={() => void attachGeneratedProductImage(proposal)}
                                    disabled={status.state === "executing"}
                                    className="rounded-xl border border-fuchsia-200 bg-white px-3 py-2 text-xs font-black text-fuchsia-700 disabled:opacity-50">
                                    ใช้รูปนี้ในสินค้า
                                  </button> : null}
                                  {status.message ? <span className={`text-[11px] font-bold ${status.state === "error" ? "text-red-600" : "text-emerald-600"}`}>{status.message}</span> : null}
                                </div>
                              </div>
                            );
                          }

                          const detail = proposal.type === "update_product_price"
                            ? `฿${money(proposal.current_price)} → ฿${money(proposal.new_price)}`
                            : proposal.type === "create_product"
                              ? `${proposal.category} · สต๊อก ${money(proposal.stock_quantity)} · หน้าร้าน ฿${money(proposal.store_price)} · เดลิเวอรี่ ฿${money(proposal.delivery_price)}`
                              : `${money(proposal.current_quantity)} ${proposal.unit} · ปรับ ${proposal.quantity_delta > 0 ? "+" : ""}${money(proposal.quantity_delta)} ${proposal.unit}`;
                          return (
                            <div key={proposal.id} className="rounded-2xl border border-blue-200 bg-blue-50/70 p-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <strong className="text-sm font-black text-blue-950">{proposal.title}</strong>
                                <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black text-white">ยืนยัน + PIN</span>
                              </div>
                              <p className="mt-2 text-sm font-black text-slate-900">{detail}</p>
                              <p className="mt-1 text-xs leading-5 text-slate-600">{proposal.reason}</p>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => requestExecution(proposal)}
                                  disabled={status.state === "executing" || status.state === "success"}
                                  className="rounded-xl bg-gradient-to-r from-blue-600 to-cyan-500 px-3 py-2 text-xs font-black text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {status.state === "executing" ? "กำลังดำเนินการ..." : status.state === "success" ? "ดำเนินการแล้ว" : "ตรวจสอบและยืนยัน"}
                                </button>
                                {status.message ? <span className={`text-[11px] font-bold ${status.state === "error" ? "text-red-600" : "text-emerald-600"}`}>{status.message}</span> : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              ))}
              {sending ? (
                <div className="w-full py-3">
                  <div className="mx-auto w-full max-w-[820px] px-1 text-sm font-medium text-slate-500">
                    <span className="inline-flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-slate-400" />กำลังวิเคราะห์ข้อมูลร้าน...</span>
                  </div>
                </div>
              ) : null}
                <div ref={chatEndRef} />
              </div>
              {showScrollToBottom ? (
                <button
                  type="button"
                  onClick={() => {
                    setAutoScroll(true);
                    setShowScrollToBottom(false);
                    scrollToBottom("smooth");
                  }}
                  className="absolute bottom-3 right-4 z-10 inline-flex h-9 items-center gap-1 rounded-full border border-slate-200 bg-white/95 px-3 text-xs font-black text-slate-600 shadow-lg backdrop-blur transition hover:border-blue-200 hover:text-blue-700"
                >
                  ↓ กลับลงล่าง
                </button>
              ) : null}
            </div>

            <form onSubmit={submit} className="sticky bottom-0 z-20 shrink-0 bg-gradient-to-t from-[#f8fbff] via-[#f8fbff]/95 to-transparent px-3 pb-4 pt-6 sm:px-6">
              {imageName ? (
                <div className="mx-auto mb-2 flex max-w-[860px] items-center gap-2 px-2">
                  <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-blue-100 bg-white/80 px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm">
                    <span aria-hidden>🖼️</span><span className="truncate">{imageName}</span>
                    <button type="button" onClick={() => { setImageDataUrl(null); setImageName(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} className="text-slate-400 hover:text-red-600" aria-label="เอารูปออก">×</button>
                  </span>
                </div>
              ) : null}
              <div className="mx-auto flex max-w-[860px] items-end gap-2 rounded-[28px] border border-white/90 bg-white/82 p-2 shadow-[0_14px_42px_rgba(30,64,175,0.10)] backdrop-blur-xl focus-within:border-blue-200">
                <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(event) => attachImage(event.target.files?.[0] ?? null)} />
                <button type="button" onClick={() => fileInputRef.current?.click()} disabled={sending} className="mb-1 grid h-9 w-9 shrink-0 place-items-center rounded-full text-xl font-light text-slate-600 transition hover:bg-slate-100 disabled:opacity-40" aria-label="แนบรูปภาพ" title="แนบรูปเพื่อวิเคราะห์">＋</button>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(event) => {
                    setInput(event.target.value);
                    resizeComposer(event.currentTarget);
                  }}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  maxLength={1200}
                  placeholder={quota?.exhausted ? "โควตา AI เดือนนี้ครบแล้ว" : quota?.enabled === false ? "AI ถูกปิดสำหรับร้านนี้" : "พิมพ์คำถามถึง CpiPOS AI..."}
                  className="max-h-32 min-h-[42px] flex-1 resize-none border-0 bg-transparent px-1 py-2.5 text-[15px] font-normal leading-6 text-slate-900 outline-none placeholder:text-slate-400"
                />
                <button
                  type="submit"
                  disabled={sending || (!input.trim() && !imageDataUrl) || quota?.exhausted || quota?.enabled === false}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                  aria-label="ส่งข้อความ"
                >
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
                  </svg>
                </button>
              </div>
              <p className="mx-auto mt-2 max-w-[820px] px-2 text-center text-[10px] font-normal text-slate-400">แนบรูปได้เมื่อจำเป็น · CpiPOS AI อาจตอบคลาดเคลื่อนได้ · การเปลี่ยนราคา/สต๊อกต้องยืนยันและผ่าน PIN Owner/Manager</p>
            </form>
          </section>
          </div>
        </div>
      </section>

      <AiModal
        open={quotaPopupOpen && Boolean(quota?.exhausted)}
        title="โควตา CpiPOS AI ของแพ็กเกจครบแล้ว"
        subtitle={quota ? `รอบเดือน ${quota.month_key} · การใช้งานถึงเพดานที่ฝ่าย IT กำหนด` : undefined}
        onClose={() => setQuotaPopupOpen(false)}
      >
        <div className="space-y-4">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-black">CpiPOS AI ถูกพักการส่งคำถามใหม่ชั่วคราว</p>
            <p className="mt-1 leading-6">ระบบจะเปิดใช้งานต่อเมื่อรอบโควตาใหม่เริ่มต้น หรือเมื่อร้านซื้อ AI Add-on / ฝ่าย IT เพิ่มสิทธิ์ให้ร้าน</p>
          </div>
          {quota ? <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-bold text-slate-500">จำนวนคำขอ</p>
              <p className="mt-1 text-xl font-black text-slate-950">{quota.usage.requests}{quota.limits.requests != null ? ` / ${quota.limits.requests}` : ""}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-bold text-slate-500">Tokens</p>
              <p className="mt-1 text-xl font-black text-slate-950">{new Intl.NumberFormat("th-TH").format(quota.usage.total_tokens)}{quota.limits.tokens != null ? ` / ${new Intl.NumberFormat("th-TH").format(quota.limits.tokens)}` : ""}</p>
            </div>
          </div> : null}
          <p className="text-xs font-semibold text-slate-500">
            ถึงเพดานจาก: {quota?.exhausted_by.map((item) => item === "requests" ? "จำนวนครั้ง" : item === "tokens" ? "Tokens" : "งบ AI").join(" · ") || "โควตาแพ็กเกจ"}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Link href="/preview/pos/payments/support?open=chat&subject=CpiPOS%20AI%20quota"
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-blue-200 bg-blue-50 px-4 text-sm font-black text-blue-700">
              ติดต่อศูนย์ช่วยเหลือ
            </Link>
            <Link href="/preview/pos/payments/package?mode=ai-addon"
              className="inline-flex min-h-12 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-black text-white shadow-sm">
              ซื้อแพ็กเกจ AI เพิ่ม
            </Link>
          </div>
        </div>
      </AiModal>

      {roomDrawerOpen ? (
        <div className="fixed inset-0 z-[110] bg-slate-950/35 lg:hidden" onMouseDown={(event) => { if (event.target === event.currentTarget) setRoomDrawerOpen(false); }}>
          <aside className="h-full w-[300px] max-w-[86vw] overflow-hidden border-r border-slate-200 bg-[#f7f7f8] shadow-2xl">
            <div className="flex h-12 items-center justify-between border-b border-slate-200 px-3">
              <strong className="text-sm font-semibold text-slate-800">CpiPOS AI</strong>
              <button type="button" onClick={() => setRoomDrawerOpen(false)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-200">×</button>
            </div>
            <div className="h-[calc(100%-48px)]">
              <ChatRoomPanel
                rooms={rooms}
                activeRoomId={activeRoomId}
                busy={roomBusy || sending}
                todaySales={overview?.today.net_sales ?? null}
                onCreate={() => void createRoom()}
                onOpen={(roomId) => void openRoom(roomId)}
                onDelete={(room) => void deleteRoom(room)}
                onOpenToday={() => { setRoomDrawerOpen(false); setTodayModalOpen(true); }}
                onOpenRecommendations={() => { setRoomDrawerOpen(false); setRecommendationModalOpen(true); }}
              />
            </div>
          </aside>
        </div>
      ) : null}

      <AiModal
        open={todayModalOpen}
        title="ข้อมูลสำคัญวันนี้"
        subtitle={overviewLoading ? "กำลังโหลดข้อมูลร้าน..." : `อัปเดต ${updatedLabel}`}
        onClose={() => setTodayModalOpen(false)}
      >
        {overviewError ? <p className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">{overviewError}</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricCard
            tone="green"
            label="ยอดขายวันนี้"
            value={overview ? `฿${money(overview.today.net_sales)}` : "—"}
            note={overview ? `${overview.today.receipts} บิล · เฉลี่ย ฿${money(overview.today.average_receipt)}` : "รอข้อมูลร้าน"}
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19h16M7 16V9M12 16V5M17 16v-4"/></svg>}
          />
          <MetricCard
            tone="blue"
            label="สินค้าขายดี"
            value={bestSeller?.name ?? "—"}
            note={bestSeller ? `${money(bestSeller.units)} หน่วย` : "ยังไม่มีข้อมูลการขาย"}
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m12 3 2.1 4.3 4.9.7-3.5 3.4.8 4.8-4.3-2.3-4.3 2.3.8-4.8L5 8l4.9-.7Z"/></svg>}
          />
          <MetricCard
            tone="orange"
            label="วัตถุดิบใกล้หมด"
            value={overview ? `${overview.stock.low_stock_count} รายการ` : "—"}
            note={overview?.stock.low_stock?.[0]?.name ? `เร่งตรวจ: ${overview.stock.low_stock[0].name}` : "ยังไม่พบรายการต่ำกว่าเกณฑ์"}
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16v12H4zM7 7V4h10v3M8 12h8"/></svg>}
          />
          <MetricCard
            tone="violet"
            label="มาร์จิ้นต่ำสุด"
            value={lowMargin ? `${money(lowMargin.margin_pct)}%` : "—"}
            note={lowMargin?.name ?? (overview?.cost.available ? "ยังไม่มีสูตรต้นทุนครบ" : "ยังอ่านข้อมูลต้นทุนไม่ได้")}
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="8"/><path d="M8 14l2-2 2 2 4-5"/></svg>}
          />
        </div>
        <div className="mt-4 flex flex-wrap justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-medium leading-5 text-slate-500">ข้อมูลชุดนี้ใช้ overview ที่โหลดอยู่แล้ว จึงไม่ยิง API ซ้ำทุกครั้งที่เปิดหน้าต่าง</p>
          <button type="button" onClick={() => void refreshOverview()} className="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-50">รีเฟรชข้อมูล</button>
        </div>
      </AiModal>

      <AiModal
        open={recommendationModalOpen}
        title="เมนูแนะนำสำหรับคุณ"
        subtitle="เลือกงานที่ต้องการ ระบบจะเปิดเมนูที่เกี่ยวข้องหรือส่งคำถามให้ CpiPOS AI ทันที"
        onClose={() => setRecommendationModalOpen(false)}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <Link href="/preview/pos/sales-summary" onClick={() => setRecommendationModalOpen(false)} className="group flex min-h-[86px] items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 transition hover:border-blue-200 hover:bg-blue-50/60">
            <span><span className="block text-sm font-black text-slate-800">สรุปยอดขาย</span><span className="mt-1 block text-xs font-medium text-slate-500">ตรวจยอด ภาษี และช่องทางชำระ</span></span><span className="text-slate-400 group-hover:text-blue-600">›</span>
          </Link>
          <Link href="/preview/pos/product-sales" onClick={() => setRecommendationModalOpen(false)} className="group flex min-h-[86px] items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 transition hover:border-blue-200 hover:bg-blue-50/60">
            <span><span className="block text-sm font-black text-slate-800">สินค้าขายดี</span><span className="mt-1 block text-xs font-medium text-slate-500">ดูสินค้า จำนวน และอันดับขายดี</span></span><span className="text-slate-400 group-hover:text-blue-600">›</span>
          </Link>
          <Link href="/preview/pos/stock" onClick={() => setRecommendationModalOpen(false)} className="group flex min-h-[86px] items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 transition hover:border-blue-200 hover:bg-blue-50/60">
            <span><span className="block text-sm font-black text-slate-800">วิเคราะห์ต้นทุนและสต๊อก</span><span className="mt-1 block text-xs font-medium text-slate-500">สินค้า วัตถุดิบ สูตร และต้นทุน</span></span><span className="text-slate-400 group-hover:text-blue-600">›</span>
          </Link>
          <button type="button" onClick={() => { setRecommendationModalOpen(false); void sendMessage("ช่วยคิดโปรโมชันเพิ่มยอดขายจากข้อมูลร้านของฉัน"); }} disabled={sending} className="group flex min-h-[86px] items-center justify-between rounded-2xl border border-violet-200 bg-violet-50/50 px-4 py-3 text-left transition hover:bg-violet-50 disabled:opacity-50">
            <span><span className="block text-sm font-black text-violet-800">ช่วยทำการตลาด</span><span className="mt-1 block text-xs font-medium text-violet-600">ให้ AI เสนอโปรโมชันจากข้อมูลจริง</span></span><span className="text-violet-400 group-hover:text-violet-700">›</span>
          </button>
        </div>
        <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50/70 px-4 py-3 text-xs font-medium leading-5 text-amber-800">
          <strong className="font-black">หมายเหตุ:</strong> การวิเคราะห์ต้นทุนเป็นค่าประมาณจากข้อมูลวัตถุดิบและสูตรที่บันทึกในระบบ การเปลี่ยนข้อมูลจริงใน Phase 2 ต้องยืนยันและผ่าน PIN และทุกการทำงานจะบันทึก Audit Log
        </div>
      </AiModal>

      {pendingProposal && pendingProposal.requires_pin ? (
        <PosManagerApprovalModal
          open
          title="ยืนยันการทำงานของ CpiPOS AI"
          action={pendingProposal.type === "adjust_stock" ? "stock_adjustment" : "sales_record_edit"}
          targetTable={pendingProposal.type === "adjust_stock" ? "ingredients" : "products"}
          targetId={pendingProposal.type === "adjust_stock" ? pendingProposal.ingredient_id : pendingProposal.product_id}
          onClose={() => setPendingProposal(null)}
          onApproved={(approvalId) => void executeProposal(pendingProposal, approvalId)}
          lang={lang === "en" ? "en" : "th"}
        />
      ) : null}
    </main>
  );
}
