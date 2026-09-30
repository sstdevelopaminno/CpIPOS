"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type DocumentRow = {
  id: string;
  title: string;
  file_name: string;
  format: string;
  size_bytes: number;
  created_at: string;
  expires_at: string | null;
};

type Payload = {
  documents: DocumentRow[];
  usage: { count: number; bytes: number };
  policy: { storage_limit_mb: number | null; retention_days: number | null; max_file_mb: number | null };
};

type Envelope<T> = { data?: T | null; error?: { message?: string } | null };

function bytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function dt(value: string | null) {
  if (!value) return "ไม่กำหนด";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("th-TH", { dateStyle: "medium" });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

export function PosAiDocumentVault() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/pos/ai/documents", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as Envelope<Payload> | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? "โหลดเอกสารไม่สำเร็จ");
      setData(body.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดเอกสารไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const usedMb = Number(data?.usage.bytes ?? 0) / 1024 / 1024;
  const limitMb = data?.policy.storage_limit_mb ?? null;
  const percent = useMemo(() => limitMb ? Math.min(100, (usedMb / limitMb) * 100) : 0, [usedMb, limitMb]);

  async function download(document: DocumentRow) {
    setBusy(`download:${document.id}`);
    setError("");
    try {
      const response = await fetch(`/api/pos/ai/documents/${encodeURIComponent(document.id)}`);
      const body = (await response.json().catch(() => null)) as Envelope<{ signed_url?: string }> | null;
      if (!response.ok || !body?.data?.signed_url) throw new Error(body?.error?.message ?? "เปิดไฟล์ไม่สำเร็จ");
      window.open(body.data.signed_url, "_blank", "noopener,noreferrer");
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "เปิดไฟล์ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function printPdf(document: DocumentRow) {
    setBusy(`print:${document.id}`);
    setError("");
    try {
      const response = await fetch(`/api/pos/ai/documents/${encodeURIComponent(document.id)}?mode=content`);
      const body = (await response.json().catch(() => null)) as Envelope<{ content?: string; document?: DocumentRow }> | null;
      if (!response.ok || typeof body?.data?.content !== "string") throw new Error(body?.error?.message ?? "เปิดเอกสารไม่สำเร็จ");
      const popup = window.open("", "_blank", "noopener,noreferrer,width=900,height=760");
      if (!popup) throw new Error("เบราว์เซอร์บล็อกหน้าต่างสำหรับพิมพ์");
      popup.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(document.title)}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Thai",sans-serif;margin:40px;color:#111827;line-height:1.65}h1{font-size:24px}pre{white-space:pre-wrap;font:inherit}small{color:#64748b}@media print{button{display:none}}</style></head><body><h1>${escapeHtml(document.title)}</h1><small>CpiPOS AI</small><pre>${escapeHtml(body.data.content)}</pre><script>setTimeout(()=>window.print(),250)<\/script></body></html>`);
      popup.document.close();
    } catch (printError) {
      setError(printError instanceof Error ? printError.message : "พิมพ์เอกสารไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function remove(document: DocumentRow) {
    if (!window.confirm(`ลบเอกสาร “${document.title}” หรือไม่?`)) return;
    setBusy(`delete:${document.id}`);
    setError("");
    try {
      const response = await fetch(`/api/pos/ai/documents/${encodeURIComponent(document.id)}`, { method: "DELETE" });
      const body = (await response.json().catch(() => null)) as Envelope<unknown> | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "ลบเอกสารไม่สำเร็จ");
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "ลบเอกสารไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-[#f6f9ff] p-4 sm:p-6">
      <section className="mx-auto w-full max-w-[1180px]">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-600">AI DOCUMENT VAULT</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950">เก็บไฟล์เอกสาร</h1>
            <p className="mt-1 text-sm text-slate-500">เก็บสรุปยอด ตาราง แผนการตลาด และเอกสารจาก CpiPOS AI โดยไฟล์แยกออกจากฐานข้อมูลหลัก</p>
          </div>
          <Link href="/preview/pos/ai-assistant" className="rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm font-bold text-blue-700">เปิด CpiPOS AI</Link>
        </header>

        {error ? <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

        <section className="mt-5 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><span className="text-xs font-bold text-slate-500">พื้นที่ใช้งาน</span><strong className="ml-2 text-lg text-slate-950">{bytes(data?.usage.bytes ?? 0)}{limitMb ? ` / ${limitMb} MB` : ""}</strong></div>
            <span className="text-xs font-semibold text-slate-500">เก็บ {data?.policy.retention_days ? `${data.policy.retention_days} วัน` : "ตามแพ็กเกจ/สัญญา"} · สูงสุด {data?.policy.max_file_mb ?? 5} MB/ไฟล์</span>
          </div>
          {limitMb ? <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-500" style={{ width: `${percent}%` }} /></div> : null}
        </section>

        <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="font-black text-slate-900">เอกสารของฉัน</h2>
            <span className="text-xs font-semibold text-slate-400">{data?.usage.count ?? 0} ไฟล์</span>
          </div>
          <div className="divide-y divide-slate-100">
            {loading ? <div className="p-8 text-center text-sm text-slate-400">กำลังโหลด…</div> :
            !data?.documents.length ? <div className="p-10 text-center text-sm leading-6 text-slate-400">ยังไม่มีเอกสาร<br />กด “บันทึกเอกสาร” ใต้คำตอบของ CpiPOS AI เพื่อเก็บไว้ที่นี่</div> :
            data.documents.map((document) => (
              <article key={document.id} className="flex flex-wrap items-center gap-3 px-4 py-4">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700">▤</div>
                <div className="min-w-[220px] flex-1">
                  <strong className="block truncate text-sm text-slate-900">{document.title}</strong>
                  <span className="mt-1 block text-xs text-slate-400">{document.file_name} · {bytes(document.size_bytes)} · สร้าง {dt(document.created_at)} · หมดอายุ {dt(document.expires_at)}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void printPdf(document)} disabled={Boolean(busy)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">พิมพ์ / บันทึก PDF</button>
                  <button type="button" onClick={() => void download(document)} disabled={Boolean(busy)} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50">ดาวน์โหลด</button>
                  <button type="button" onClick={() => void remove(document)} disabled={Boolean(busy)} className="rounded-lg border border-red-100 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50">ลบ</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
