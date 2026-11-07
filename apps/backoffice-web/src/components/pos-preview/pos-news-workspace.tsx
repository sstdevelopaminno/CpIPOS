"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Language } from "@/lib/i18n";

type NewsItem = {
  id: string;
  title: string;
  body: string;
  published_at: string;
  image_url: string | null;
  link_url: string | null;
  is_latest: boolean;
  is_read: boolean;
};

function Bell({ tone }: { tone: "latest" | "unread" | "read" }) {
  const color = tone === "latest" ? "text-amber-500 bg-amber-50 border-amber-200"
    : tone === "unread" ? "text-emerald-600 bg-emerald-50 border-emerald-200"
    : "text-slate-400 bg-slate-50 border-slate-200";
  return (
    <span className={"inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border " + color}>
      <svg width="22" height="22" viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.8" aria-hidden>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </svg>
    </span>
  );
}

export function PosNewsWorkspace({ lang }: { lang: Language }) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [selected, setSelected] = useState<NewsItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const result = await fetch("/api/pos/news", { cache: "no-store" });
        const body = await result.json() as { data?: { items?: NewsItem[]; unread_count?: number }; error?: { message?: string } };
        if (!result.ok || !body.data) throw new Error(body.error?.message || "news_unavailable");
        if (!alive) return;
        setItems(body.data.items ?? []);
        setUnreadCount(body.data.unread_count ?? 0);
        setError("");
      } catch {
        if (alive) setError(lang === "en" ? "Unable to load announcements" : "โหลดข่าวสารไม่ได้ กรุณาลองอีกครั้ง");
      } finally { if (alive) setLoading(false); }
    }
    void load();
    const onFocus = () => void load();
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisible); };
  }, [lang]);

  async function open(item: NewsItem) {
    setSelected(item);
    if (item.is_read || busyId) return;
    setBusyId(item.id);
    try {
      const result = await fetch("/api/pos/news/" + encodeURIComponent(item.id), { method: "POST", cache: "no-store" });
      if (!result.ok) throw new Error("failed");
      setItems(current => current.map(entry => entry.id === item.id ? { ...entry, is_read: true } : entry));
      setSelected({ ...item, is_read: true });
      setUnreadCount(current => Math.max(0, current - 1));
      window.dispatchEvent(new Event("cpi-news-read"));
    } catch {
      setError(lang === "en" ? "Read status could not be saved" : "ยังบันทึกสถานะการอ่านไม่ได้");
    } finally { setBusyId(null); }
  }

  const date = (value: string) => new Date(value).toLocaleString(lang === "lo" ? "lo-LA" : lang === "en" ? "en-US" : "th-TH", { dateStyle: "medium", timeStyle: "short" });
  const tr = (th: string, en: string, lo: string) => lang === "en" ? en : lang === "lo" ? lo : th;

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-slate-50 px-3 py-5 text-slate-950 sm:px-6">
      <section className="mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-extrabold">{tr("แจ้งข่าวสาร", "Announcements", "ແຈ້ງຂ່າວສານ")}</h1>
          <span className="rounded-full bg-amber-50 px-3 py-1 text-sm font-bold text-amber-700">
            {tr("ยังไม่อ่าน", "Unread", "ຍັງບໍ່ອ່ານ")} {unreadCount}
          </span>
        </div>
        {error ? <div role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
        {loading ? <div role="status" className="py-8 text-slate-500">{tr("กำลังโหลด...", "Loading...", "ກຳລັງໂຫຼດ...")}</div>
          : items.length === 0 ? <p className="py-10 text-center text-slate-500">{tr("ยังไม่มีข่าวสารจาก CpiPOS IT", "No announcements yet", "ຍັງບໍ່ມີຂ່າວສານ")}</p>
          : <div className="space-y-2">
            {items.map(item => (
              <button type="button" key={item.id} onClick={() => void open(item)} className="flex w-full items-start gap-3 rounded-2xl border border-slate-200 p-4 text-left transition hover:border-sky-200 hover:bg-sky-50/50">
                <Bell tone={item.is_read ? "read" : item.is_latest ? "latest" : "unread"} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <strong className="break-words text-base">{item.title}</strong>
                    {!item.is_read && item.is_latest ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">{tr("ล่าสุด", "Latest", "ຫຼ້າສຸດ")}</span> : null}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">{date(item.published_at)}</span>
                  <span className="mt-1 block max-w-full truncate text-sm text-slate-600">{item.body}</span>
                </span>
                <span className="pt-2 text-slate-400" aria-hidden>›</span>
              </button>
            ))}
          </div>}
      </section>
      {selected ? (
        <div role="presentation" onClick={() => setSelected(null)} className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/65 p-3">
          <article role="dialog" aria-modal="true" aria-label={selected.title} onClick={event => event.stopPropagation()} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 text-slate-950 shadow-2xl sm:p-7">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div><h2 className="text-xl font-extrabold">{selected.title}</h2><p className="mt-1 text-sm text-slate-500">{date(selected.published_at)}</p></div>
              <button type="button" aria-label={tr("ปิด", "Close", "ປິດ")} onClick={() => setSelected(null)} className="rounded-lg border border-slate-200 px-3 py-1 text-lg">×</button>
            </div>
            {selected.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selected.image_url} alt={selected.title} className="mb-4 max-h-96 w-full rounded-xl object-contain" />
            ) : null}
            <div className="whitespace-pre-line break-words text-[15px] leading-7 text-slate-700">{selected.body}</div>
            {selected.link_url ? <div className="mt-6"><a target="_blank" rel="noopener noreferrer" href={selected.link_url} className="inline-flex rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">{tr("ดูรายละเอียดเพิ่มเติม", "Open link", "ເປີດລິ້ງ")}</a></div> : null}
            <div className="mt-5 text-right"><button type="button" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white" onClick={() => setSelected(null)}>{tr("ปิดหน้าต่าง", "Close", "ປິດ")}</button></div>
            {busyId === selected.id ? <p role="status" className="mt-2 text-sm text-blue-600">{tr("กำลังบันทึกสถานะการอ่าน...", "Saving read status...", "ກຳລັງບັນທຶກ...")}</p> : null}
          </article>
        </div>
      ) : null}
    </main>
  );
}
