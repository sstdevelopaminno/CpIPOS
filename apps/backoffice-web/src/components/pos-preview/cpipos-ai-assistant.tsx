"use client";

import Image from "next/image";
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
  error?: { message?: string } | null;
};

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
  return (
    <div className="space-y-1.5">
      {lines.map((raw, index) => {
        const line = raw.trimEnd();
        if (!line.trim()) return <div key={index} className="h-1" />;
        const bullet = line.match(/^[-•]\s+(.+)$/);
        const numbered = line.match(/^\d+[.)]\s+(.+)$/);
        if (bullet) {
          return <div key={index} className="flex gap-2"><span className="mt-[1px] text-blue-500">•</span><span><InlineRichText text={bullet[1]} /></span></div>;
        }
        if (numbered) {
          return <div key={index} className="flex gap-2"><span className="font-bold text-blue-600">{line.match(/^\d+/)?.[0]}.</span><span><InlineRichText text={numbered[1]} /></span></div>;
        }
        return <p key={index}><InlineRichText text={line} /></p>;
      })}
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
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingProposal, setPendingProposal] = useState<AiProposal | null>(null);
  const [proposalStatus, setProposalStatus] = useState<Record<string, ProposalStatus>>({});
  const [todayModalOpen, setTodayModalOpen] = useState(false);
  const [recommendationModalOpen, setRecommendationModalOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage(lang)]);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const lowMargin = overview?.cost.low_margin_products?.[0] ?? null;
  const bestSeller = overview?.today.top_products?.[0] ?? overview?.last_30_days.top_products?.[0] ?? null;

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
    let cancelled = false;
    async function loadOverview() {
      setOverviewLoading(true);
      setOverviewError(null);
      try {
        const response = await fetch("/api/pos/ai/assistant", { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as ApiEnvelope<{ overview?: Overview; history?: ChatMessage[]; quota?: AiQuotaStatus }>;
        if (!response.ok) throw new Error(body?.error?.message ?? "ไม่สามารถโหลดข้อมูลร้านได้");
        if (!cancelled) {
          setOverview(body?.data?.overview ?? null);
          setQuota(body?.data?.quota ?? null);
          const storedHistory = Array.isArray(body?.data?.history)
            ? body.data.history.filter((message) => message.role === "user" || message.role === "assistant")
            : [];
          setMessages(storedHistory.length ? storedHistory : [welcomeMessage(lang)]);
        }
      } catch (error) {
        if (!cancelled) setOverviewError(error instanceof Error ? error.message : "ไม่สามารถโหลดข้อมูลร้านได้");
      } finally {
        if (!cancelled) setOverviewLoading(false);
      }
    }
    void loadOverview();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  async function sendMessage(prompt?: string) {
    const messageText = String(prompt ?? input).trim();
    if (!messageText || sending || quota?.exhausted || quota?.enabled === false) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: messageText
    };
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setSending(true);

    try {
      const response = await fetch("/api/pos/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: messageText })
      });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<{ answer?: string; overview?: Overview; proposals?: AiProposal[]; quota?: AiQuotaStatus }>;
      if (!response.ok) throw new Error(body?.error?.message ?? "CpiPOS AI ไม่สามารถตอบได้ในขณะนี้");

      if (body?.data?.overview) setOverview(body.data.overview);
      if (body?.data?.quota) setQuota(body.data.quota);
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
          text: error instanceof Error ? error.message : "CpiPOS AI ไม่สามารถตอบได้ในขณะนี้"
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
      if (!response.ok) throw new Error(body?.error?.message ?? "ไม่สามารถล้างประวัติ AI ได้");
      setMessages([welcomeMessage(lang)]);
      setProposalStatus({});
    } catch (error) {
      setMessages((current) => [...current, {
        id: `history-error-${Date.now()}`,
        role: "assistant",
        text: error instanceof Error ? error.message : "ไม่สามารถล้างประวัติ AI ได้"
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
      : `${proposal.ingredient_name}: ${money(proposal.quantity_delta)} ${proposal.unit}`;
    if (!window.confirm(`ยืนยันรายการที่ CpiPOS AI เตรียมไว้?\n\n${detail}\n\nขั้นตอนถัดไปต้องกรอก PIN Owner/Manager ก่อนระบบจึงจะเปลี่ยนข้อมูลจริง`)) return;
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
        : `ปรับสต๊อก ${proposal.ingredient_name} ${proposal.quantity_delta > 0 ? "+" : ""}${money(proposal.quantity_delta)} ${proposal.unit} เรียบร้อยแล้ว`;
      setProposalStatus((current) => ({ ...current, [proposal.id]: { state: "success", message: successText } }));
      setMessages((current) => [...current, {
        id: `assistant-action-${Date.now()}`,
        role: "assistant",
        text: `✅ ${successText}\nระบบบันทึก Audit Log ของรายการนี้แล้วครับ`
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
    <main className="h-full min-h-0 w-full overflow-y-auto bg-[#f5f9ff] p-3 sm:p-4 xl:p-5">
      <section className="mx-auto flex min-h-full w-full max-w-[1500px] flex-col gap-3">
        <header className="relative overflow-hidden rounded-3xl border border-blue-100 bg-[radial-gradient(circle_at_78%_15%,rgba(56,189,248,0.28),transparent_24%),linear-gradient(120deg,#ffffff,#eef6ff_58%,#e9fbff)] px-4 py-4 shadow-[0_10px_35px_rgba(37,99,235,0.08)] sm:px-6">
          <div className="absolute -right-6 -top-8 h-32 w-32 rounded-full bg-blue-300/20 blur-2xl" />
          <div className="relative flex items-center gap-4">
            <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white bg-white/85 shadow-lg shadow-blue-500/10">
              <Image src="/brand/cpipos-symbol-sidebar.png" alt="CpiPOS" width={50} height={50} className="h-12 w-12 object-contain" priority />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-black tracking-tight text-[#0d2344] sm:text-2xl">CpiPOS AI ผู้ช่วยร้านค้า</h1>
              </div>
              <p className="mt-1 text-sm font-medium text-slate-600">ผู้ช่วยอัจฉริยะสำหรับยอดขาย ต้นทุน สต๊อก และการตลาด — วิเคราะห์จากข้อมูลร้านใน CpiPOS</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-blue-100 bg-white/75 px-2.5 py-1 text-[10px] font-bold text-blue-700">
                  ประวัติส่วนตัวตามบัญชี Owner/Manager · OpenAI Conversation
                </span>
                {quota ? (
                  <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${quota.exhausted ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                    เดือน {quota.month_key}: {quota.usage.requests}{quota.limits.requests ? `/${quota.limits.requests}` : ""} ครั้ง · {new Intl.NumberFormat("th-TH").format(quota.usage.total_tokens)} tokens
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => void clearHistory()}
                  disabled={sending}
                  className="rounded-full border border-slate-200 bg-white/80 px-2.5 py-1 text-[10px] font-bold text-slate-500 transition hover:border-red-200 hover:text-red-600 disabled:opacity-50"
                >
                  ล้างประวัติของฉัน
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setTodayModalOpen(true)}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-blue-200 bg-white/90 px-3 text-xs font-black text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
                >
                  <span aria-hidden>📊</span>
                  ข้อมูลสำคัญวันนี้
                  {overview ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px]">฿${money(overview.today.net_sales)}</span> : null}
                </button>
                <button
                  type="button"
                  onClick={() => setRecommendationModalOpen(true)}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-violet-200 bg-white/90 px-3 text-xs font-black text-violet-700 shadow-sm transition hover:border-violet-300 hover:bg-violet-50"
                >
                  <SparkleIcon size={14} />
                  เมนูแนะนำสำหรับคุณ
                </button>
              </div>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1">
          <section className="flex min-h-[620px] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_12px_36px_rgba(15,23,42,0.07)]">
            <div className="border-b border-slate-100 px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-black uppercase tracking-[0.14em] text-blue-600">AI CHAT</span>
                <span className="text-xs font-medium text-slate-400">ถามเป็นภาษาไทยได้เลย</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void sendMessage(prompt)}
                    disabled={sending || quota?.exhausted || quota?.enabled === false}
                    className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 disabled:cursor-wait disabled:opacity-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-[linear-gradient(180deg,#ffffff,#fbfdff)] px-4 py-5 sm:px-5">
              {messages.map((message) => (
                <div key={message.id} className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  {message.role === "assistant" ? (
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-white shadow-sm">
                      <Image src="/brand/cpipos-symbol-sidebar.png" alt="" width={28} height={28} className="h-7 w-7 object-contain" />
                    </span>
                  ) : null}
                  <div className={`max-w-[86%] ${message.role === "user" ? "" : "min-w-0"}`}>
                    <div className={`rounded-2xl px-4 py-3 text-sm font-medium leading-6 shadow-sm ${message.role === "user" ? "rounded-br-md bg-gradient-to-br from-blue-600 to-cyan-500 text-white" : "rounded-bl-md border border-slate-100 bg-slate-50 text-slate-700"}`}>
                      <AiRichText text={message.text} />
                    </div>
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

                          const detail = proposal.type === "update_product_price"
                            ? `฿${money(proposal.current_price)} → ฿${money(proposal.new_price)}`
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
              ))}
              {sending ? (
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-white shadow-sm">
                    <Image src="/brand/cpipos-symbol-sidebar.png" alt="" width={28} height={28} className="h-7 w-7 object-contain" />
                  </span>
                  <div className="rounded-2xl rounded-bl-md border border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-500">
                    <span className="inline-flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />กำลังวิเคราะห์ข้อมูลร้าน...</span>
                  </div>
                </div>
              ) : null}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={submit} className="border-t border-slate-100 bg-white p-3 sm:p-4">
              <div className="flex items-end gap-2 rounded-2xl border border-blue-200 bg-white p-2 shadow-[0_5px_20px_rgba(37,99,235,0.06)] focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
                <span className="mb-2 ml-1 text-blue-500"><SparkleIcon size={19} /></span>
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={1}
                  maxLength={1200}
                  placeholder={quota?.exhausted ? "โควตา AI เดือนนี้ครบแล้ว" : quota?.enabled === false ? "AI ถูกปิดสำหรับร้านนี้" : "พิมพ์คำถามถึง CpiPOS AI..."}
                  className="max-h-32 min-h-[42px] flex-1 resize-none border-0 bg-transparent px-1 py-2.5 text-sm font-medium text-slate-800 outline-none placeholder:text-slate-400"
                />
                <button
                  type="submit"
                  disabled={sending || !input.trim() || quota?.exhausted || quota?.enabled === false}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 text-white shadow-lg shadow-blue-500/20 transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="ส่งข้อความ"
                >
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" />
                  </svg>
                </button>
              </div>
              <p className="mt-2 px-1 text-[11px] font-medium text-slate-400">Phase 2: AI เตรียมรายการให้ได้ แต่การเปลี่ยนราคา/สต๊อกจะเกิดขึ้นเฉพาะเมื่อคุณกดยืนยันและผ่าน PIN Owner/Manager เท่านั้น</p>
            </form>
          </section>


        </div>
      </section>

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
          action={pendingProposal.type === "update_product_price" ? "sales_record_edit" : "stock_adjustment"}
          targetTable={pendingProposal.type === "update_product_price" ? "products" : "ingredients"}
          targetId={pendingProposal.type === "update_product_price" ? pendingProposal.product_id : pendingProposal.ingredient_id}
          onClose={() => setPendingProposal(null)}
          onApproved={(approvalId) => void executeProposal(pendingProposal, approvalId)}
          lang={lang === "en" ? "en" : "th"}
        />
      ) : null}
    </main>
  );
}
