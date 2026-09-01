"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Language } from "@/lib/i18n";
import { fetchWithTimeout } from "@/lib/client-fetch";

type ServiceEventType = "call_staff" | "request_checkout";
type ActivityEventType = "order" | ServiceEventType;
type AckAction = "acknowledge" | "go_to_table";

type ActivityEvent = {
  id: string;
  table_id: string;
  event_type: ActivityEventType;
  item_count: number | null;
  subtotal: number | null;
  created_at: string;
  table: { id: string; table_code: string; table_name: string | null } | null;
};

type ActivityResponse = {
  data?: { events?: ActivityEvent[]; cursor?: string; server_time?: string };
  error?: { message?: string } | null;
};

type PendingServiceAck = {
  event: ActivityEvent;
  action: AckAction;
};

const CURSOR_KEY = "pos_global_table_qr_cursor_v1";
const ACKED_EVENT_IDS_KEY = "pos_global_table_qr_acked_event_ids_v1";
const ACTIVITY_REQUEST_TIMEOUT_MS = 10_000;
// Vercel Hobby request-budget guard: operational alerts may refresh immediately on
// focus/visibility/user activity, but recurring idle reads never run faster than 30s.
const IDLE_POLL_MS = [30_000, 45_000, 60_000] as const;
const SEEN_EVENT_LIMIT = 300;

function isServiceEvent(event: ActivityEvent): event is ActivityEvent & { event_type: ServiceEventType } {
  return event.event_type === "call_staff" || event.event_type === "request_checkout";
}

function trimSeenSet(seen: Set<string>) {
  while (seen.size > SEEN_EVENT_LIMIT) {
    const first = seen.values().next().value as string | undefined;
    if (!first) break;
    seen.delete(first);
  }
}

function readAcknowledgedEventIds(): Set<string> {
  try {
    const raw = window.sessionStorage.getItem(ACKED_EVENT_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    const ids = parsed.filter((value): value is string => typeof value === "string" && value.length > 0);
    return new Set(ids.slice(-SEEN_EVENT_LIMIT));
  } catch {
    return new Set();
  }
}

function persistAcknowledgedEventId(id: string) {
  try {
    const ids = readAcknowledgedEventIds();
    ids.add(id);
    trimSeenSet(ids);
    window.sessionStorage.setItem(ACKED_EVENT_IDS_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // Session persistence is best-effort; in-memory dedupe remains active.
  }
}

function titleFor(event: ActivityEvent, lang: Language) {
  const table = event.table?.table_code || "-";
  if (lang === "en") {
    if (event.event_type === "order") return `New food order · Table ${table}`;
    if (event.event_type === "call_staff") return `Table ${table} calls staff`;
    return `Table ${table} requests checkout`;
  }
  if (event.event_type === "order") return `มีรายการสั่งอาหารใหม่จากโต๊ะ ${table}`;
  if (event.event_type === "call_staff") return `โต๊ะ ${table} เรียกพนักงาน`;
  return `โต๊ะ ${table} ต้องการชำระบิล`;
}

export function PosTableQrGlobalAlert({ lang }: { lang: Language }) {
  const [pendingEvents, setPendingEvents] = useState<ActivityEvent[]>([]);
  const cursorRef = useRef<string>("");
  const inFlightRef = useRef(false);
  const seenEventIdsRef = useRef<Set<string>>(new Set());
  const pendingServiceAcksRef = useRef<Map<string, PendingServiceAck>>(new Map());
  const serviceAckInFlightRef = useRef<Set<string>>(new Set());
  const event = pendingEvents[0] ?? null;

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

  const persistServiceAck = useCallback(async (current: ActivityEvent, action: AckAction) => {
    if (!isServiceEvent(current)) return true;
    if (serviceAckInFlightRef.current.has(current.id)) return false;

    serviceAckInFlightRef.current.add(current.id);
    try {
      const response = await fetchWithTimeout("/api/pos/table-qr-activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_id: current.id, action }),
        keepalive: true
      }, ACTIVITY_REQUEST_TIMEOUT_MS);
      const body = (await response.json().catch(() => null)) as ActivityResponse | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message || "activity_ack_failed");
      pendingServiceAcksRef.current.delete(current.id);
      return true;
    } catch {
      pendingServiceAcksRef.current.set(current.id, { event: current, action });
      return false;
    } finally {
      serviceAckInFlightRef.current.delete(current.id);
    }
  }, []);

  const flushPendingServiceAcks = useCallback(() => {
    const pending = Array.from(pendingServiceAcksRef.current.values()).slice(0, 5);
    for (const item of pending) void persistServiceAck(item.event, item.action);
  }, [persistServiceAck]);

  const acknowledge = useCallback((current: ActivityEvent, action: AckAction) => {
    // Mark the exact event before navigation/remount so an inclusive cursor cannot replay it.
    seenEventIdsRef.current.add(current.id);
    trimSeenSet(seenEventIdsRef.current);
    persistAcknowledgedEventId(current.id);

    // Optimistic UI: dismiss locally first so the button always responds immediately.
    setPendingEvents((queue) => queue.filter((row) => row.id !== current.id));

    // Food-order acknowledgement deliberately stays local: the underlying QR submission
    // remains pending until staff reviews it at the table. Service requests persist their ack.
    if (isServiceEvent(current)) void persistServiceAck(current, action);

    if (action === "go_to_table") {
      try { localStorage.setItem("pos_dine_in_selected_table_v001", current.table_id); } catch { /* ignore */ }
      window.location.assign("/preview/pos");
    }
  }, [persistServiceAck]);

  useEffect(() => {
    if (event?.id) playAlert();
  }, [event?.id, playAlert]);

  useEffect(() => {
    seenEventIdsRef.current = readAcknowledgedEventIds();
    try {
      cursorRef.current = sessionStorage.getItem(CURSOR_KEY) || new Date().toISOString();
    } catch {
      cursorRef.current = new Date().toISOString();
    }

    let disposed = false;
    let authBlocked = false;
    let timer: number | null = null;
    let idleIndex = 0;

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = (delayMs: number) => {
      clearTimer();
      if (disposed || authBlocked || document.visibilityState === "hidden") return;
      timer = window.setTimeout(() => void poll(), delayMs);
    };

    const poll = async () => {
      if (disposed || authBlocked || document.visibilityState === "hidden") return;
      if (inFlightRef.current) {
        schedule(IDLE_POLL_MS[idleIndex]);
        return;
      }

      flushPendingServiceAcks();
      inFlightRef.current = true;
      let sawEvent = false;
      try {
        const since = cursorRef.current || new Date().toISOString();
        const response = await fetchWithTimeout(
          `/api/pos/table-qr-activity?since=${encodeURIComponent(since)}`,
          { cache: "no-store" },
          ACTIVITY_REQUEST_TIMEOUT_MS
        );
        if (response.status === 401 || response.status === 403) {
          // An expired/revoked POS tab must not keep hammering operational APIs forever.
          authBlocked = true;
          clearTimer();
          return;
        }
        const body = (await response.json().catch(() => null)) as ActivityResponse | null;
        if (response.ok && body?.data) {
          const events = body.data.events ?? [];
          const cursor = body.data.cursor || body.data.server_time || since;
          cursorRef.current = cursor;
          try { sessionStorage.setItem(CURSOR_KEY, cursor); } catch { /* ignore */ }

          const fresh = events.filter((row) => !seenEventIdsRef.current.has(row.id));
          for (const row of fresh) seenEventIdsRef.current.add(row.id);
          trimSeenSet(seenEventIdsRef.current);

          if (fresh.length > 0) {
            sawEvent = true;
            setPendingEvents((current) => {
              const queuedIds = new Set(current.map((row) => row.id));
              const additions = fresh.filter((row) => !queuedIds.has(row.id));
              return additions.length > 0 ? [...current, ...additions] : current;
            });
          }
        }
      } catch {
        // Fail soft. The adaptive schedule below backs off instead of hammering the API.
      } finally {
        inFlightRef.current = false;
        if (!disposed && !authBlocked) {
          if (sawEvent) {
            idleIndex = 0;
          } else if (idleIndex < IDLE_POLL_MS.length - 1) {
            idleIndex += 1;
          }
          schedule(IDLE_POLL_MS[idleIndex]);
        }
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        clearTimer();
        return;
      }
      if (authBlocked) return;
      idleIndex = 0;
      schedule(0);
    };
    const onFocus = () => {
      if (authBlocked) return;
      idleIndex = 0;
      schedule(0);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    schedule(0);

    return () => {
      disposed = true;
      clearTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [flushPendingServiceAcks]);

  if (!event) return null;
  const tableCode = event.table?.table_code || "-";
  const isOrder = event.event_type === "order";
  const queuedAfterCurrent = Math.max(0, pendingEvents.length - 1);

  return (
    <aside className="fixed right-4 top-4 z-[120] w-[min(92vw,390px)] rounded-2xl border border-blue-200 bg-white p-4 text-slate-900 shadow-2xl" role="alertdialog" aria-live="assertive">
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-600 text-lg text-white">{isOrder ? "🍜" : event.event_type === "call_staff" ? "🔔" : "💳"}</div>
        <div className="min-w-0 flex-1">
          <strong className="block text-[16px]">{titleFor(event, lang)}</strong>
          {isOrder ? (
            <span className="mt-1 block text-[13px] text-slate-600">
              {lang === "th"
                ? `${event.item_count ?? 0} รายการ · ฿${Number(event.subtotal ?? 0).toFixed(2)}`
                : `${event.item_count ?? 0} items · ฿${Number(event.subtotal ?? 0).toFixed(2)}`}
            </span>
          ) : null}
          {queuedAfterCurrent > 0 ? (
            <span className="mt-1 block text-[12px] font-semibold text-blue-700">
              {lang === "th" ? `มีอีก ${queuedAfterCurrent} แจ้งเตือนรออยู่` : `${queuedAfterCurrent} more alert${queuedAfterCurrent === 1 ? "" : "s"} queued`}
            </span>
          ) : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded-xl bg-blue-600 px-3 py-2 text-[13px] font-bold text-white active:translate-y-px"
              onClick={() => acknowledge(event, "go_to_table")}
            >
              {lang === "th" ? `ไปที่โต๊ะ ${tableCode}` : `Open table ${tableCode}`}
            </button>
            <button
              type="button"
              className="rounded-xl border border-slate-300 px-3 py-2 text-[13px] font-semibold active:translate-y-px"
              onClick={() => acknowledge(event, "acknowledge")}
            >
              {lang === "th" ? "รับทราบ" : "Dismiss"}
            </button>
          </div>
          {isOrder ? (
            <span className="mt-2 block text-[11px] font-semibold text-slate-500">
              {lang === "th"
                ? "กดรับทราบเพื่อซ่อนแจ้งเตือนเท่านั้น รายการอาหารยังค้างรอตรวจจนกว่าจะยืนยัน/ปฏิเสธที่โต๊ะ"
                : "Dismiss only hides this alert; the food order remains pending until reviewed at the table."}
            </span>
          ) : null}
        </div>
      </div>
    </aside>
  );
}
