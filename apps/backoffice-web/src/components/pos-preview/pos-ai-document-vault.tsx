"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";

type DocumentRow = {
  id: string;
  title: string;
  category: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  expires_at: string | null;
};

type Policy = {
  enabled: boolean;
  source: "package" | "tenant_custom" | "tenant_unlimited";
  retention_days: number | null;
  storage_limit_mb: number | null;
  max_files: number | null;
};

type Usage = { files: number; bytes: number; storage_mb: number };
type ApiEnvelope<T> = { data?: T | null; error?: { message?: string } | null };

const CATEGORY_LABEL: Record<string,string> = {
  general: "ทั่วไป",
  sales: "ยอดขาย",
  stock: "สต๊อก",
  cost: "ต้นทุน",
  marketing: "การตลาด",
  accounting: "บัญชี",
  guide: "คู่มือ"
};

function formatDate(value: string | null) {
  if (!value) return "ไม่หมดอายุ";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" }).format(date);
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

export function PosAiDocumentVault({ lang: _lang }: { lang: Language }) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/pos/ai/documents", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<{ documents?: DocumentRow[]; policy?: Policy; usage?: Usage }>;
      if (!response.ok) throw new Error(body?.error?.message ?? "โหลดเอกสารไม่สำเร็จ");
      setDocuments(Array.isArray(body?.data?.documents) ? body!.data!.documents! : []);
      setPolicy(body?.data?.policy ?? null);
      setUsage(body?.data?.usage ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "โหลดเอกสารไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const storagePct = useMemo(() => {
    if (!policy?.storage_limit_mb || !usage) return 0;
    return Math.min(100, (usage.storage_mb / policy.storage_limit_mb) * 100);
  }, [policy, usage]);

  async function download(documentId: string) {
    setBusyId(documentId);
    try {
      const response = await fetch(`/api/pos/ai/documents/${encodeURIComponent(documentId)}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<{ signed_url?: string }>;
      if (!response.ok || !body?.data?.signed_url) throw new Error(body?.error?.message ?? "เปิดไฟล์ไม่สำเร็จ");
      window.open(body.data.signed_url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err instanceof Error ? err.message : "เปิดไฟล์ไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  async function printPdf(documentId: string) {
    setBusyId(documentId);
    try {
      const response = await fetch(`/api/pos/ai/documents/${encodeURIComponent(documentId)}?content=1`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<{ document?: DocumentRow; content?: string }>;
      if (!response.ok || !body?.data?.document) throw new Error(body?.error?.message ?? "เปิดเอกสารไม่สำเร็จ");
      const popup = window.open("", "_blank", "width=900,height=900");
      if (!popup) throw new Error("เบราว์เซอร์ปิดกั้นหน้าต่างพิมพ์ กรุณาอนุญาต Popup");
      const title = escapeHtml(body.data.document.title);
      const content = escapeHtml(String(body.data.content ?? ""));
      popup.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${title}</title><style>
        @page{size:A4;margin:18mm} body{font-family:"Noto Sans Thai","Segoe UI",Tahoma,sans-serif;color:#111827;line-height:1.65;font-size:13px}
        h1{font-size:22px;margin:0 0 18px} pre{white-space:pre-wrap;font:inherit;margin:0} .meta{color:#64748b;font-size:11px;margin-bottom:20px}
      </style></head><body><h1>${title}</h1><div class="meta">สร้างจาก CpiPOS AI · ${new Date(body.data.document.created_at).toLocaleString("th-TH")}</div><pre>${content}</pre><script>setTimeout(()=>window.print(),250)<\/script></body></html>`);
      popup.document.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : "เปิดเอกสารไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(documentId: string, title: string) {
    if (!window.confirm(`ลบเอกสาร “${title}” หรือไม่?\nไฟล์ที่เก็บไว้จะถูกลบด้วย`)) return;
    setBusyId(documentId);
    try {
      const response = await fetch(`/api/pos/ai/documents/${encodeURIComponent(documentId)}`, { method: "DELETE" });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<{ deleted?: boolean }>;
      if (!response.ok) throw new Error(body?.error?.message ?? "ลบเอกสารไม่สำเร็จ");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ลบเอกสารไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-[radial-gradient(circle_at_80%_0%,rgba(96,165,250,0.15),transparent_30%),linear-gradient(180deg,#f8fbff,#f4f7fb)] p-4 sm:p-6">
      <section className="mx-auto w-full max-w-[1240px]">
        <header className="flex flex-wrap items-center justify-between gap-4 pb-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-slate-950">เก็บไฟล์เอกสาร</h1>
            <p className="mt-1 text-sm text-slate-500">เก็บสรุปยอดขาย รายงานต้นทุน แผนการตลาด ตาราง และเอกสารที่สร้างจาก CpiPOS AI</p>
          </div>
          <div className="flex gap-2">
            <Link href="/preview/pos/ai-assistant" className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">สร้างเอกสารจาก AI</Link>
            <button type="button" onClick={() => void load()} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">รีเฟรช</button>
          </div>
        </header>

        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/80 bg-white/75 p-4 shadow-sm backdrop-blur"><p className="text-xs font-semibold text-slate-500">จำนวนไฟล์</p><p className="mt-1 text-2xl font-semibold">{usage?.files ?? 0}{policy?.max_files ? <span className="text-sm font-normal text-slate-400"> / {policy.max_files}</span> : null}</p></div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-4 shadow-sm backdrop-blur"><p className="text-xs font-semibold text-slate-500">พื้นที่เอกสาร</p><p className="mt-1 text-2xl font-semibold">{usage?.storage_mb ?? 0} MB{policy?.storage_limit_mb ? <span className="text-sm font-normal text-slate-400"> / {policy.storage_limit_mb} MB</span> : null}</p>{policy?.storage_limit_mb ? <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500" style={{width:`${storagePct}%`}} /></div> : null}</div>
          <div className="rounded-2xl border border-white/80 bg-white/75 p-4 shadow-sm backdrop-blur"><p className="text-xs font-semibold text-slate-500">ระยะเวลาเก็บ</p><p className="mt-1 text-2xl font-semibold">{policy?.retention_days ? `${policy.retention_days} วัน` : "ตามที่ IT กำหนด"}</p></div>
        </div>

        {error ? <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div> : null}

        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/85 shadow-sm backdrop-blur">
          {loading ? <div className="p-10 text-center text-sm text-slate-400">กำลังโหลดเอกสาร...</div> :
          documents.length === 0 ? <div className="p-14 text-center"><div className="text-4xl">📄</div><h2 className="mt-3 text-lg font-semibold text-slate-800">ยังไม่มีเอกสาร</h2><p className="mt-1 text-sm text-slate-500">ในหน้า CpiPOS AI กด “บันทึกเป็นเอกสาร” ที่คำตอบที่ต้องการเก็บไว้</p></div> :
          <div className="divide-y divide-slate-100">
            {documents.map((row) => <div key={row.id} className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-5">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-lg">📄</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-semibold text-slate-900">{row.title}</h3><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{CATEGORY_LABEL[row.category] ?? "ทั่วไป"}</span></div>
                <p className="mt-1 text-xs text-slate-400">{formatDate(row.created_at)} · {formatBytes(row.size_bytes)} · เก็บถึง {formatDate(row.expires_at)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busyId===row.id} onClick={() => void printPdf(row.id)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">พิมพ์ / PDF</button>
                <button type="button" disabled={busyId===row.id} onClick={() => void download(row.id)} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">ดาวน์โหลดต้นฉบับ</button>
                <button type="button" disabled={busyId===row.id} onClick={() => void remove(row.id,row.title)} className="rounded-lg border border-red-100 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">ลบ</button>
              </div>
            </div>)}
          </div>}
        </section>
      </section>
    </main>
  );
}
