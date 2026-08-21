"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type TimeState = {
  expiry_mode: "time" | "bill";
  ttl_minutes: number | null;
  expires_at: string;
  server_time: string;
};

type TimeStateBody = {
  data?: TimeState;
  error?: { code?: string; message?: string } | null;
};

const STATUS_REFRESH_MS = 30_000;
const COUNTDOWN_TICK_MS = 1_000;
const WARNING_THRESHOLD_MS = 30 * 60_000;
const CRITICAL_THRESHOLD_MS = 5 * 60_000;

function formatRemaining(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${String(hours).padStart(2, "0")}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function TableQrCountdownGuard({ token }: { token: string }) {
  const [state, setState] = useState<TimeState | null>(null);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [tick, setTick] = useState(() => Date.now());
  const [hardClosed, setHardClosed] = useState(false);
  const inFlightRef = useRef(false);
  const endpoint = useMemo(() => `/api/table-order/${encodeURIComponent(token)}/time-state`, [token]);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as TimeStateBody | null;
      if (response.status === 410 || body?.error?.code === "table_order_link_expired") {
        setHardClosed(true);
        return;
      }
      if (!response.ok || !body?.data) return;
      const serverNowMs = Date.parse(body.data.server_time);
      setServerOffsetMs(Number.isFinite(serverNowMs) ? serverNowMs - Date.now() : 0);
      setState(body.data);
      setTick(Date.now());
      setHardClosed(false);
    } catch {
      // Keep the last known countdown on temporary network failures. The ordering API
      // independently rejects every write after expires_at, so this UI never weakens server safety.
    } finally {
      inFlightRef.current = false;
    }
  }, [endpoint]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), STATUS_REFRESH_MS);
    const onFocus = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    if (state?.expiry_mode !== "time" || hardClosed) return;
    const interval = window.setInterval(() => setTick(Date.now()), COUNTDOWN_TICK_MS);
    return () => window.clearInterval(interval);
  }, [hardClosed, state?.expiry_mode]);

  const expiresAtMs = state ? Date.parse(state.expires_at) : Number.NaN;
  const remainingMs = state?.expiry_mode === "time" && Number.isFinite(expiresAtMs)
    ? Math.max(0, expiresAtMs - (tick + serverOffsetMs))
    : Number.POSITIVE_INFINITY;
  const expired = hardClosed || (state?.expiry_mode === "time" && Number.isFinite(expiresAtMs) && remainingMs <= 0);

  useEffect(() => {
    if (!expired) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [expired]);

  if (expired) {
    return (
      <div className="fixed inset-0 z-[9999] grid place-items-center bg-slate-950/95 p-5 text-center text-white pointer-events-auto" role="alertdialog" aria-modal="true" aria-labelledby="table-qr-expired-title">
        <section className="w-full max-w-md rounded-3xl border border-red-400/30 bg-slate-900 p-7 shadow-2xl">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-red-500/15 text-3xl" aria-hidden="true">⏱</div>
          <h1 id="table-qr-expired-title" className="mt-5 text-3xl font-black">หมดเวลาสั่งอาหาร</h1>
          <p className="mt-3 text-base font-semibold leading-7 text-slate-200">
            ไม่สามารถสั่งเพิ่มหรือกดรายการใดได้แล้ว กรุณาชำระเงินที่แคชเชียร์หรือติดต่อพนักงาน
          </p>
          <div className="mt-5 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-sm font-black text-amber-100">
            กรุณานำเลขโต๊ะไปชำระเงิน
          </div>
        </section>
      </div>
    );
  }

  if (!state || state.expiry_mode !== "time") return null;

  const critical = remainingMs <= CRITICAL_THRESHOLD_MS;
  const warning = remainingMs <= WARNING_THRESHOLD_MS;
  const tone = critical
    ? "border-red-300 bg-red-600 text-white shadow-red-950/30"
    : warning
      ? "border-amber-300 bg-amber-300 text-amber-950 shadow-amber-950/20"
      : "border-blue-200 bg-white/95 text-blue-950 shadow-slate-900/15";

  return (
    <aside className={`pointer-events-none fixed left-1/2 top-3 z-[90] w-[min(92vw,430px)] -translate-x-1/2 rounded-2xl border px-4 py-3 shadow-xl backdrop-blur ${tone}`} role="status" aria-live={warning ? "assertive" : "polite"}>
      <div className="flex items-center justify-between gap-4">
        <span className="min-w-0">
          <strong className="block text-xs font-black uppercase tracking-[0.12em]">{warning ? "แจ้งเตือนเวลาสั่งอาหาร" : "เวลาสั่งอาหารคงเหลือ"}</strong>
          <span className={`mt-0.5 block text-xs font-semibold ${critical ? "text-red-100" : warning ? "text-amber-800" : "text-blue-700"}`}>
            เมื่อหมดเวลา ระบบจะล็อกการสั่งเพิ่มและให้ชำระเงิน
          </span>
        </span>
        <strong className="shrink-0 tabular-nums text-2xl font-black tracking-tight">{formatRemaining(remainingMs)}</strong>
      </div>
    </aside>
  );
}
