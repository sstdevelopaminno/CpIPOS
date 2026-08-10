"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Language } from "@/lib/i18n";

type ActivityEvent = {
  id: string;
  table_id: string;
  event_type: "order" | "call_staff" | "request_checkout";
  item_count: number | null;
  subtotal: number | null;
  created_at: string;
  table: { id: string; table_code: string; table_name: string | null } | null;
};

type ActivityResponse = {
  data?: { events?: ActivityEvent[]; cursor?: string; server_time?: string };
};

const CURSOR_KEY = "pos_global_table_qr_cursor_v1";
const POLL_MS = 3000;

function titleFor(event: ActivityEvent, lang: Language) {
  const table = event.table?.table_code || "-";
  if (lang === "en") {
    if (event.event_type === "call_staff") return `Table ${table} calls staff`;
    if (event.event_type === "request_checkout") return `Table ${table} requests checkout`;
    return `New QR order · Table ${table}`;
  }
  if (event.event_type === "call_staff") return `โต๊ะ ${table} เรียกพนักงาน`;
  if (event.event_type === "request_checkout") return `โต๊ะ ${table} ต้องการชำระบิล`;
  return `มีรายการสั่งใหม่จากโต๊ะ ${table}`;
}

export function PosTableQrGlobalAlert({ lang }: { lang: Language }) {
  const [event, setEvent] = useState<ActivityEvent | null>(null);
  const cursorRef = useRef<string>("");
  const inFlightRef = useRef(false);

  const playAlert = useCallback(() => {
    try {
      const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      const context = new AudioContextCtor();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = 880;
      gain.gain.value = 0.08;
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.12);
      oscillator.addEventListener("ended", () => void context.close());
    } catch {
      // Browser audio may require a user gesture. The visual alert remains visible.
    }
  }, []);

  useEffect(() => {
    try {
      cursorRef.current = sessionStorage.getItem(CURSOR_KEY) || new Date().toISOString();
    } catch {
      cursorRef.current = new Date().toISOString();
    }

    let disposed = false;
    const poll = async () => {
      if (disposed || inFlightRef.current || document.visibilityState === "hidden") return;
      inFlightRef.current = true;
      try {
        const since = cursorRef.current || new Date().toISOString();
        const response = await fetch(`/api/pos/table-qr-activity?since=${encodeURIComponent(since)}`, { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as ActivityResponse | null;
        if (!response.ok || !body?.data) return;
        const events = body.data.events ?? [];
        const cursor = body.data.cursor || body.data.server_time || since;
        cursorRef.current = cursor;
        try { sessionStorage.setItem(CURSOR_KEY, cursor); } catch { /* ignore */ }
        const latest = events.at(-1);
        if (latest) {
          setEvent(latest);
          playAlert();
        }
      } catch {
        // Keep the POS usable while alert polling recovers on the next interval.
      } finally {
        inFlightRef.current = false;
      }
    };

    const timer = window.setInterval(() => void poll(), POLL_MS);
    const onFocus = () => void poll();
    window.addEventListener("focus", onFocus);
    void poll();
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [playAlert]);

  if (!event) return null;
  const tableCode = event.table?.table_code || "-";
  const isOrder = event.event_type === "order";

  return (
    <aside className="fixed right-4 top-4 z-[120] w-[min(92vw,390px)] rounded-2xl border border-blue-200 bg-white p-4 text-slate-900 shadow-2xl" role="alert" aria-live="assertive">
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-600 text-lg text-white">{isOrder ? "🍜" : event.event_type === "call_staff" ? "🔔" : "💳"}</div>
        <div className="min-w-0 flex-1">
          <strong className="block text-[16px]">{titleFor(event, lang)}</strong>
          {isOrder ? <span className="mt-1 block text-[13px] text-slate-600">{lang === "th" ? `${event.item_count ?? 0} รายการ · ฿${Number(event.subtotal ?? 0).toFixed(2)}` : `${event.item_count ?? 0} items · ฿${Number(event.subtotal ?? 0).toFixed(2)}`}</span> : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded-xl bg-blue-600 px-3 py-2 text-[13px] font-bold text-white"
              onClick={() => {
                try { localStorage.setItem("pos_dine_in_selected_table_v001", event.table_id); } catch { /* ignore */ }
                window.location.assign("/preview/pos");
              }}
            >
              {lang === "th" ? `ไปที่โต๊ะ ${tableCode}` : `Open table ${tableCode}`}
            </button>
            <button type="button" className="rounded-xl border border-slate-300 px-3 py-2 text-[13px] font-semibold" onClick={() => setEvent(null)}>
              {lang === "th" ? "รับทราบ" : "Dismiss"}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
