"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type KitchenStatus = "queued" | "acknowledged" | "preparing" | "ready" | "cancelled";
type KitchenItem = { id: string; product_name: string; quantity: number; notes: string | null; action: string };
type KitchenTicket = {
  id: string;
  order_id: string;
  order_no: string;
  order_type: string;
  table_id: string | null;
  customer_name: string | null;
  order_notes: string | null;
  event_type: string;
  queue_no: number | null;
  round_no: number | null;
  status: KitchenStatus;
  created_at: string;
  zone: { id: string; zone_code: string; zone_name: string; kds_enabled?: boolean } | null;
  items: KitchenItem[];
  print_jobs: Array<{ id: string; status: string; last_error: string | null }>;
};

type QueueResponse = { data?: { tickets?: KitchenTicket[] }; error?: { message?: string } };
type UnlockedZone = { id: string; zone_code: string; zone_name: string; kds_enabled: boolean };

type KitchenAlertState = {
  open: boolean;
  count: number;
  latest: KitchenTicket | null;
  soundBlocked: boolean;
};

const COLUMNS: Array<{ status: KitchenStatus; label: string; empty: string }> = [
  { status: "queued", label: "รายการใหม่", empty: "ยังไม่มีรายการใหม่" },
  { status: "acknowledged", label: "รับแล้ว", empty: "ยังไม่มีรายการที่รับแล้ว" },
  { status: "preparing", label: "กำลังทำ", empty: "ยังไม่มีรายการกำลังทำ" },
  { status: "ready", label: "พร้อมเสิร์ฟ", empty: "ยังไม่มีรายการพร้อมเสิร์ฟ" }
];

const ALERT_DURATION_MS = 15_000;
const SEEN_TICKET_LIMIT = 300;
const ALERT_EVENT_TYPES = new Set(["new", "add"]);

function ticketAlertKey(ticket: KitchenTicket) {
  return `${ticket.id}:${ticket.event_type}:${ticket.round_no ?? 1}`;
}

function shouldAlertTicket(ticket: KitchenTicket) {
  return ALERT_EVENT_TYPES.has(ticket.event_type) && ticket.zone?.kds_enabled === true;
}

function trimSeenSet(seen: Set<string>) {
  while (seen.size > SEEN_TICKET_LIMIT) {
    const first = seen.values().next().value as string | undefined;
    if (!first) break;
    seen.delete(first);
  }
}

function ageText(createdAt: string, now: number) {
  const ms = Math.max(0, now - new Date(createdAt).getTime());
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "เมื่อสักครู่";
  if (minutes < 60) return `${minutes} นาที`;
  return `${Math.floor(minutes / 60)} ชม. ${minutes % 60} นาที`;
}

function nextStatus(status: KitchenStatus): KitchenStatus | null {
  if (status === "queued") return "acknowledged";
  if (status === "acknowledged") return "preparing";
  if (status === "preparing") return "ready";
  return null;
}

function nextLabel(status: KitchenStatus) {
  if (status === "queued") return "รับงาน";
  if (status === "acknowledged") return "เริ่มทำ";
  if (status === "preparing") return "พร้อมเสิร์ฟ";
  return "";
}

export function KitchenKds() {
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [unlockedZone, setUnlockedZone] = useState<UnlockedZone | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const inFlightRef = useRef(false);
  const baselineReadyRef = useRef(false);
  const seenAlertKeysRef = useRef<Set<string>>(new Set());
  const alertTimerRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioLoopTimerRef = useRef<number | null>(null);
  const [alertState, setAlertState] = useState<KitchenAlertState>({ open: false, count: 0, latest: null, soundBlocked: false });

  const stopAlertSound = useCallback(() => {
    if (audioLoopTimerRef.current) {
      window.clearInterval(audioLoopTimerRef.current);
      audioLoopTimerRef.current = null;
    }
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, []);

  const closeAlert = useCallback(() => {
    if (alertTimerRef.current) {
      window.clearTimeout(alertTimerRef.current);
      alertTimerRef.current = null;
    }
    stopAlertSound();
    setAlertState((current) => ({ ...current, open: false, count: 0 }));
  }, [stopAlertSound]);

  const armAlertSound = useCallback(async () => {
    if (!audioRef.current) audioRef.current = new Audio("/sounds/kitchen-alert.wav");
    const audio = audioRef.current;
    audio.preload = "auto";
    audio.loop = false;
    audio.volume = 0;
    try {
      audio.currentTime = 0;
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 1;
      setAlertState((current) => ({ ...current, soundBlocked: false }));
    } catch {
      audio.volume = 1;
      setAlertState((current) => ({ ...current, soundBlocked: true }));
    }
  }, []);

  const playAlertSound = useCallback(() => {
    if (!audioRef.current) audioRef.current = new Audio("/sounds/kitchen-alert.wav");
    const audio = audioRef.current;
    audio.preload = "auto";
    audio.loop = false;
    audio.volume = 1;
    const playOnce = () => {
      audio.currentTime = 0;
      audio.play()
        .then(() => setAlertState((current) => ({ ...current, soundBlocked: false })))
        .catch(() => setAlertState((current) => ({ ...current, soundBlocked: true })));
    };
    stopAlertSound();
    playOnce();
    audioLoopTimerRef.current = window.setInterval(playOnce, 2400);
  }, [stopAlertSound]);

  const showNewTicketAlert = useCallback((ticket: KitchenTicket, increment: number) => {
    setAlertState((current) => ({
      open: true,
      count: current.open ? current.count + increment : increment,
      latest: ticket,
      soundBlocked: current.soundBlocked
    }));
    playAlertSound();
    if (alertTimerRef.current) window.clearTimeout(alertTimerRef.current);
    alertTimerRef.current = window.setTimeout(() => {
      closeAlert();
    }, ALERT_DURATION_MS);
  }, [closeAlert, playAlertSound]);

  const applyTickets = useCallback((nextTickets: KitchenTicket[]) => {
    const alertable = nextTickets.filter((ticket) => shouldAlertTicket(ticket) && ticket.zone?.id === unlockedZone?.id);
    if (!baselineReadyRef.current) {
      for (const ticket of alertable) seenAlertKeysRef.current.add(ticketAlertKey(ticket));
      trimSeenSet(seenAlertKeysRef.current);
      baselineReadyRef.current = true;
      setTickets(nextTickets);
      return;
    }

    const fresh = alertable.filter((ticket) => {
      const key = ticketAlertKey(ticket);
      if (seenAlertKeysRef.current.has(key)) return false;
      seenAlertKeysRef.current.add(key);
      return true;
    });
    trimSeenSet(seenAlertKeysRef.current);
    setTickets(nextTickets);
    if (fresh.length > 0) showNewTicketAlert(fresh[fresh.length - 1], fresh.length);
  }, [showNewTicketAlert, unlockedZone?.id]);

  const loadUnlockedZone = useCallback(async () => {
    try {
      const response = await fetch("/api/pos/kitchen/unlock", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as { data?: { zone?: UnlockedZone | null }; error?: { message?: string } } | null;
      if (response.ok) setUnlockedZone(body?.data?.zone ?? null);
    } catch {
      setUnlockedZone(null);
    }
  }, []);

  async function unlockZone() {
    if (unlocking || accessCode.length !== 6) return;
    setUnlocking(true);
    try {
      const response = await fetch("/api/pos/kitchen/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_code: accessCode })
      });
      const body = (await response.json().catch(() => null)) as { data?: { zone?: UnlockedZone }; error?: { message?: string } } | null;
      if (!response.ok || !body?.data?.zone) throw new Error(body?.error?.message ?? "เปิดจอครัวไม่สำเร็จ");
      baselineReadyRef.current = false;
      seenAlertKeysRef.current = new Set();
      closeAlert();
      setUnlockedZone(body.data.zone);
      setAccessCode("");
      setError(null);
      await armAlertSound();
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : "เปิดจอครัวไม่สำเร็จ");
    } finally {
      setUnlocking(false);
    }
  }

  const load = useCallback(async (silent = false) => {
    if (inFlightRef.current || !unlockedZone?.id) return;
    inFlightRef.current = true;
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ status: "queued,acknowledged,preparing,ready", limit: "100", zone_id: unlockedZone.id });
      const response = await fetch(`/api/pos/kitchen/queue?${params.toString()}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as QueueResponse | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? "โหลดคิวครัวไม่สำเร็จ");
      applyTickets(body.data.tickets ?? []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดคิวครัวไม่สำเร็จ");
    } finally {
      inFlightRef.current = false;
      if (!silent) setLoading(false);
    }
  }, [applyTickets, unlockedZone?.id]);

  useEffect(() => {
    void loadUnlockedZone();
    void load();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 3000);
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clock);
      window.removeEventListener("focus", onFocus);
      if (alertTimerRef.current) window.clearTimeout(alertTimerRef.current);
      stopAlertSound();
    };
  }, [load, loadUnlockedZone, stopAlertSound]);

  const byStatus = useMemo(() => {
    const map = new Map<KitchenStatus, KitchenTicket[]>();
    for (const column of COLUMNS) map.set(column.status, []);
    for (const ticket of tickets) map.get(ticket.status)?.push(ticket);
    return map;
  }, [tickets]);

  async function transition(ticket: KitchenTicket) {
    const status = nextStatus(ticket.status);
    if (!status || busyId) return;
    setBusyId(ticket.id);
    try {
      const response = await fetch(`/api/pos/kitchen/tickets/${ticket.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "เปลี่ยนสถานะไม่สำเร็จ");
      setTickets((current) => current.map((row) => (row.id === ticket.id ? { ...row, status } : row)));
      setError(null);
    } catch (transitionError) {
      setError(transitionError instanceof Error ? transitionError.message : "เปลี่ยนสถานะไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  }

  if (!unlockedZone) {
    return (
      <section className="grid h-full min-h-0 w-full place-items-center bg-slate-100 p-4 text-slate-950">
        <div className="w-full max-w-sm border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-black">เปิดจอครัว</h1>
          <p className="mt-2 text-sm font-semibold text-slate-500">ใส่ Kitchen ID 6 หลักเพื่อเปิดเฉพาะโซนครัวนี้</p>
          <input
            value={accessCode}
            onChange={(event) => setAccessCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(event) => { if (event.key === "Enter") void unlockZone(); }}
            inputMode="numeric"
            pattern="[0-9]*"
            className="mt-4 w-full rounded-lg border border-slate-300 px-4 py-3 text-center font-mono text-3xl font-black tracking-[0.25em]"
            placeholder="000000"
          />
          <button type="button" onClick={() => void unlockZone()} disabled={unlocking || accessCode.length !== 6} className="mt-4 w-full rounded-lg bg-blue-600 px-4 py-3 text-lg font-black text-white disabled:opacity-50">
            {unlocking ? "กำลังเปิด..." : "เปิดจอครัว"}
          </button>
          {error ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</p> : null}
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-100 text-slate-900">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
        <div>
          <h1 className="text-xl font-black">{unlockedZone.zone_name} - Kitchen Display</h1>
          <p className="mt-1 text-sm text-slate-500">ออเดอร์จากหน้าขายและ QR โต๊ะ อัปเดตอัตโนมัติทุก 3 วินาที</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">งานค้าง {tickets.filter((ticket) => ticket.status !== "ready").length}</span>
          <button type="button" onClick={() => void load()} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold">รีเฟรช</button>
        </div>
      </header>

      {alertState.soundBlocked ? (
        <button type="button" onClick={() => void armAlertSound()} className="mx-5 mt-3 shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-black text-amber-800">
          แตะเพื่อเปิดเสียงแจ้งเตือน
        </button>
      ) : null}
      {alertState.open && alertState.latest ? (
        <div className="fixed inset-x-3 top-4 z-50 mx-auto max-w-lg rounded-xl border-4 border-amber-400 bg-white p-5 text-slate-950 shadow-2xl sm:top-8" role="alertdialog" aria-live="assertive">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black">มีออเดอร์ใหม่{alertState.count > 1 ? ` ${alertState.count} รายการ` : ""}</h2>
              <p className="mt-1 text-sm font-bold text-slate-600">มีรายการอาหารใหม่เข้าครัว</p>
            </div>
            <button type="button" onClick={closeAlert} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-black">ปิด</button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-lg font-black">
            <div className="rounded-lg bg-slate-100 p-3">คิว<br /><span className="text-3xl">{String(alertState.latest.queue_no ?? "-").padStart(2, "0")}</span></div>
            <div className="rounded-lg bg-slate-100 p-3">รอบที่<br /><span className="text-3xl">{alertState.latest.round_no ?? 1}</span></div>
            <div className="col-span-2 rounded-lg bg-slate-100 p-3">โซน: {alertState.latest.zone?.zone_name ?? "ครัว"}</div>
            <div className="rounded-lg bg-slate-100 p-3">โต๊ะ<br /><span>{alertState.latest.table_id ?? "-"}</span></div>
            <div className="rounded-lg bg-slate-100 p-3">บิล<br /><span>{alertState.latest.order_no}</span></div>
          </div>
          <button type="button" onClick={closeAlert} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-4 text-lg font-black text-white">
            รับทราบ / ปิดแจ้งเตือน
          </button>
        </div>
      ) : null}

      {error ? <div className="mx-5 mt-3 shrink-0 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
      {loading ? <div className="grid flex-1 place-items-center text-sm font-semibold text-slate-500">กำลังโหลดคิวครัว...</div> : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-auto p-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((column) => {
            const columnTickets = byStatus.get(column.status) ?? [];
            return (
              <section key={column.status} className="flex min-h-[320px] min-w-0 flex-col rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
                <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <strong>{column.label}</strong>
                  <span className="grid h-7 min-w-7 place-items-center rounded-full bg-white px-2 text-xs font-black shadow-sm">{columnTickets.length}</span>
                </header>
                <div className="grid content-start gap-3 overflow-y-auto p-3">
                  {columnTickets.length === 0 ? <p className="py-8 text-center text-sm text-slate-400">{column.empty}</p> : null}
                  {columnTickets.map((ticket) => {
                    const minutes = Math.floor(Math.max(0, now - new Date(ticket.created_at).getTime()) / 60_000);
                    const isLate = ticket.status !== "ready" && minutes >= 10;
                    return (
                      <article key={ticket.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${isLate ? "border-red-300 ring-2 ring-red-100" : "border-slate-200"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <strong className="text-lg">Q{ticket.queue_no ?? "-"} / R{ticket.round_no ?? 1}</strong>
                            <p className="text-xs font-semibold text-slate-500">#{ticket.order_no} - {ticket.zone?.zone_name ?? "ครัว"}</p>
                          </div>
                          <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${isLate ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>{ageText(ticket.created_at, now)}</span>
                        </div>
                        <div className="mt-3 grid gap-2">
                          {ticket.items.map((item) => (
                            <div key={item.id} className="flex items-start justify-between gap-3 border-t border-slate-100 pt-2 first:border-0 first:pt-0">
                              <div>
                                <span className="font-bold">{item.product_name}</span>
                                {item.notes ? <small className="block text-xs text-orange-600">{item.notes}</small> : null}
                              </div>
                              <strong className="text-lg">x{item.quantity}</strong>
                            </div>
                          ))}
                        </div>
                        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs font-black text-slate-700">{ticket.event_type.toUpperCase()} - {ticket.order_type}</p>
                        {ticket.order_notes ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">หมายเหตุ: {ticket.order_notes}</p> : null}
                        {nextStatus(ticket.status) ? (
                          <button type="button" onClick={() => void transition(ticket)} disabled={Boolean(busyId)} className="mt-4 w-full rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-black text-white disabled:opacity-50">
                            {busyId === ticket.id ? "กำลังบันทึก..." : nextLabel(ticket.status)}
                          </button>
                        ) : <div className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-center text-sm font-black text-emerald-700">พร้อมเสิร์ฟแล้ว</div>}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}