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
type KitchenAlertState = { open: boolean; count: number; latest: KitchenTicket | null; soundBlocked: boolean };
type BillGroup = {
  key: string;
  orderNo: string;
  tableId: string | null;
  orderType: string;
  queueNo: number | null;
  createdAt: string;
  tickets: KitchenTicket[];
};

const POLL_INTERVAL_MS = 2_000;
const SEEN_TICKET_LIMIT = 300;
const ALERT_EVENT_TYPES = new Set(["new", "add"]);
const ACTIVE_STATUSES: KitchenStatus[] = ["queued", "acknowledged", "preparing"];

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

function previousStatus(status: KitchenStatus): KitchenStatus | null {
  if (status === "acknowledged") return "queued";
  if (status === "preparing") return "acknowledged";
  return null;
}

function nextLabel(status: KitchenStatus) {
  if (status === "queued") return "รับออเดอร์";
  if (status === "acknowledged") return "เริ่มทำ";
  if (status === "preparing") return "พร้อมเสิร์ฟ";
  return "";
}

function statusLabel(status: KitchenStatus) {
  if (status === "queued") return "รอรับออเดอร์";
  if (status === "acknowledged") return "รับแล้ว";
  if (status === "preparing") return "กำลังทำ";
  if (status === "ready") return "พร้อมเสิร์ฟ";
  return "ยกเลิก";
}

function statusRank(status: KitchenStatus) {
  if (status === "queued") return 0;
  if (status === "acknowledged") return 1;
  if (status === "preparing") return 2;
  if (status === "ready") return 3;
  return -1;
}

function groupStatus(tickets: KitchenTicket[]) {
  if (tickets.some((ticket) => ticket.status === "queued")) return "queued" as KitchenStatus;
  if (tickets.some((ticket) => ticket.status === "acknowledged")) return "acknowledged" as KitchenStatus;
  if (tickets.some((ticket) => ticket.status === "preparing")) return "preparing" as KitchenStatus;
  return "ready" as KitchenStatus;
}

function eventLabel(ticket: KitchenTicket) {
  if (ticket.event_type === "add" || (ticket.round_no ?? 1) > 1) return "เพิ่มรายการ";
  if (ticket.event_type === "reprint") return "พิมพ์ซ้ำ";
  return "ออเดอร์ใหม่";
}

function orderTypeLabel(orderType: string) {
  if (orderType === "dine_in") return "ทานที่ร้าน";
  if (orderType === "table_qr" || orderType === "qr_table") return "QR โต๊ะ";
  if (orderType === "takeaway") return "กลับบ้าน";
  if (orderType === "delivery") return "เดลิเวอรี";
  return orderType || "POS";
}

function formatKitchenClock(now: number) {
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(now));
}

export function KitchenKds() {
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKeys, setBusyKeys] = useState<Set<string>>(() => new Set());
  const [unlockedZone, setUnlockedZone] = useState<UnlockedZone | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [alertState, setAlertState] = useState<KitchenAlertState>({ open: false, count: 0, latest: null, soundBlocked: false });

  const inFlightRef = useRef(false);
  const baselineReadyRef = useRef(false);
  const seenAlertKeysRef = useRef<Set<string>>(new Set());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioLoopTimerRef = useRef<number | null>(null);

  const setBusy = useCallback((key: string, value: boolean) => {
    setBusyKeys((current) => {
      const next = new Set(current);
      if (value) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

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
      void audio.play()
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
  }, [playAlertSound]);

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
      const body = (await response.json().catch(() => null)) as { data?: { zone?: UnlockedZone | null } } | null;
      if (response.ok) setUnlockedZone(body?.data?.zone ?? null);
    } catch {
      setUnlockedZone(null);
    }
  }, []);

  const load = useCallback(async (silent = false) => {
    if (inFlightRef.current || !unlockedZone?.id) return;
    inFlightRef.current = true;
    if (!silent && !initialLoaded) setLoading(true);
    try {
      const params = new URLSearchParams({ status: ACTIVE_STATUSES.join(","), limit: "100", zone_id: unlockedZone.id });
      const response = await fetch(`/api/pos/kitchen/queue?${params.toString()}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as QueueResponse | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? "โหลดคิวครัวไม่สำเร็จ");
      applyTickets(body.data.tickets ?? []);
      setError(null);
      setInitialLoaded(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดคิวครัวไม่สำเร็จ");
    } finally {
      inFlightRef.current = false;
      if (!silent) setLoading(false);
    }
  }, [applyTickets, initialLoaded, unlockedZone?.id]);

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
      setTickets([]);
      setInitialLoaded(false);
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

  useEffect(() => {
    void loadUnlockedZone();
  }, [loadUnlockedZone]);

  useEffect(() => {
    if (!unlockedZone?.id) return;
    baselineReadyRef.current = false;
    void load(false);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, POLL_INTERVAL_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clock);
      window.removeEventListener("focus", onFocus);
    };
  }, [load, unlockedZone?.id]);

  useEffect(() => () => {
    stopAlertSound();
  }, [stopAlertSound]);

  const billGroups = useMemo(() => {
    const groups = new Map<string, BillGroup>();
    for (const ticket of tickets) {
      const key = ticket.order_id || ticket.order_no;
      const existing = groups.get(key);
      if (existing) {
        existing.tickets.push(ticket);
        existing.queueNo = existing.queueNo ?? ticket.queue_no;
        if (new Date(ticket.created_at).getTime() < new Date(existing.createdAt).getTime()) existing.createdAt = ticket.created_at;
      } else {
        groups.set(key, {
          key,
          orderNo: ticket.order_no,
          tableId: ticket.table_id,
          orderType: ticket.order_type,
          queueNo: ticket.queue_no,
          createdAt: ticket.created_at,
          tickets: [ticket]
        });
      }
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        tickets: group.tickets.sort((a, b) => {
          const roundA = a.round_no ?? 1;
          const roundB = b.round_no ?? 1;
          if (roundA !== roundB) return roundA - roundB;
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        })
      }))
      .sort((a, b) => {
        const queueA = a.queueNo ?? Number.MAX_SAFE_INTEGER;
        const queueB = b.queueNo ?? Number.MAX_SAFE_INTEGER;
        if (queueA !== queueB) return queueA - queueB;
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
  }, [tickets]);

  async function setTicketStatusRemote(ticket: KitchenTicket, status: KitchenStatus) {
    const response = await fetch(`/api/pos/kitchen/tickets/${ticket.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    if (!response.ok) throw new Error(body?.error?.message ?? "เปลี่ยนสถานะไม่สำเร็จ");
  }

  async function transition(ticket: KitchenTicket, targetStatus: KitchenStatus) {
    const busyKey = `ticket:${ticket.id}`;
    if (busyKeys.has(busyKey)) return;
    const previous = ticket.status;
    setBusy(busyKey, true);
    setTickets((current) => current.map((row) => (row.id === ticket.id ? { ...row, status: targetStatus } : row)));
    try {
      await setTicketStatusRemote(ticket, targetStatus);
      if (targetStatus === "ready") {
        setTickets((current) => current.filter((row) => row.id !== ticket.id));
      }
      setError(null);
    } catch (transitionError) {
      setTickets((current) => current.map((row) => (row.id === ticket.id ? { ...row, status: previous } : row)));
      setError(transitionError instanceof Error ? transitionError.message : "เปลี่ยนสถานะไม่สำเร็จ");
    } finally {
      setBusy(busyKey, false);
    }
  }

  async function finishBill(group: BillGroup) {
    const busyKey = `bill:${group.key}`;
    if (busyKeys.has(busyKey)) return;
    const previous = new Map(group.tickets.map((ticket) => [ticket.id, ticket.status] as const));
    const ids = new Set(group.tickets.map((ticket) => ticket.id));
    setBusy(busyKey, true);
    setTickets((current) => current.map((row) => (ids.has(row.id) ? { ...row, status: "ready" as KitchenStatus } : row)));
    try {
      await Promise.all(group.tickets.map((ticket) => setTicketStatusRemote(ticket, "ready")));
      setTickets((current) => current.filter((row) => !ids.has(row.id)));
      setError(null);
    } catch (finishError) {
      setTickets((current) => current.map((row) => {
        const oldStatus = previous.get(row.id);
        return oldStatus ? { ...row, status: oldStatus } : row;
      }));
      setError(finishError instanceof Error ? finishError.message : "อัปเดตทั้งบิลไม่สำเร็จ");
    } finally {
      setBusy(busyKey, false);
    }
  }

  if (!unlockedZone) {
    return (
      <section className="grid h-full min-h-0 w-full place-items-center bg-slate-100 p-4 text-slate-950">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
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

  const isOnline = !error;
  const activeBillCount = billGroups.length;

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-50 text-slate-900">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-black">{unlockedZone.zone_name}</h1>
            <span className="text-xl font-black text-slate-300">·</span>
            <span className="text-xl font-black">Kitchen Display</span>
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-500">{formatKitchenClock(now)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1.5 text-xs font-black ${isOnline ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            {isOnline ? "ครัวออนไลน์" : "กำลังเชื่อมต่อใหม่"}
          </span>
          <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700">บิลค้าง {activeBillCount}</span>
          <button type="button" onClick={() => void load(false)} disabled={loading} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-black disabled:opacity-50">
            {loading ? "กำลังรีเฟรช..." : "รีเฟรช"}
          </button>
        </div>
      </header>

      {alertState.soundBlocked ? (
        <button type="button" onClick={() => void armAlertSound()} className="mx-5 mt-3 shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-black text-amber-800">
          แตะเพื่อเปิดเสียงแจ้งเตือนออเดอร์ใหม่
        </button>
      ) : null}

      {alertState.open && alertState.latest ? (
        <div className="fixed inset-x-3 top-4 z-[150] mx-auto max-w-lg rounded-2xl border-4 border-amber-400 bg-white p-5 text-slate-950 shadow-2xl sm:top-8" role="alertdialog" aria-live="assertive">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black">มีออเดอร์ใหม่{alertState.count > 1 ? ` ${alertState.count} รายการ` : ""}</h2>
              <p className="mt-1 text-sm font-bold text-slate-600">แจ้งเตือนพร้อมเสียงจนกว่าจะกดรับทราบ</p>
            </div>
            <button type="button" onClick={closeAlert} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-black">ปิด</button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-lg font-black">
            <div className="rounded-lg bg-slate-100 p-3">คิว<br /><span className="text-3xl">{String(alertState.latest.queue_no ?? "-").padStart(2, "0")}</span></div>
            <div className="rounded-lg bg-slate-100 p-3">รอบ<br /><span className="text-3xl">{alertState.latest.round_no ?? 1}</span></div>
            <div className="rounded-lg bg-slate-100 p-3">โต๊ะ<br /><span>{alertState.latest.table_id ?? "-"}</span></div>
            <div className="rounded-lg bg-slate-100 p-3">บิล<br /><span>{alertState.latest.order_no}</span></div>
            <div className="col-span-2 rounded-lg bg-slate-100 p-3">โหมด: {orderTypeLabel(alertState.latest.order_type)}</div>
          </div>
          <button type="button" onClick={closeAlert} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-4 text-lg font-black text-white">รับทราบ</button>
        </div>
      ) : null}

      {error ? <div className="mx-5 mt-3 shrink-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{error} — ระบบยังคงแสดงข้อมูลล่าสุดและจะลองใหม่อัตโนมัติ</div> : null}

      {!initialLoaded && loading ? (
        <div className="grid flex-1 place-items-center text-sm font-semibold text-slate-500">กำลังโหลดคิวครัว...</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          {billGroups.length === 0 ? (
            <div className="grid h-full place-items-center bg-slate-50 text-sm font-bold text-slate-400">ไม่มีออเดอร์ครัวค้าง</div>
          ) : (
            <div className="flex h-full min-w-0 gap-4 overflow-x-auto overflow-y-hidden p-4">
              {billGroups.map((group) => {
                const currentStatus = groupStatus(group.tickets);
                const currentRank = statusRank(currentStatus);
                const groupBusy = busyKeys.has(`bill:${group.key}`);
                return (
                  <article key={group.key} className="flex h-full w-[360px] shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:w-[420px] xl:w-[460px]">
                    <header className="shrink-0 border-b border-slate-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-black uppercase text-slate-500">บิล {group.orderNo}</p>
                          <h2 className="mt-1 truncate text-3xl font-black">โต๊ะ {group.tableId ?? "-"}</h2>
                          <p className="mt-1 text-xs font-bold text-slate-500">{orderTypeLabel(group.orderType)}</p>
                        </div>
                        <div className="text-right">
                          <div className="rounded-lg bg-blue-50 px-3 py-2 text-lg font-black text-blue-700">Q{group.queueNo ?? "-"}</div>
                          <p className="mt-1 text-xs font-bold text-slate-500">{ageText(group.createdAt, now)}</p>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-4 overflow-hidden rounded-lg border border-slate-200 text-center text-[11px] font-black sm:text-xs">
                        {[
                          ["queued", "รอรับ"],
                          ["acknowledged", "รับแล้ว"],
                          ["preparing", "กำลังทำ"],
                          ["ready", "พร้อมเสิร์ฟ"]
                        ].map(([status, label], index) => {
                          const active = currentRank >= index;
                          return (
                            <span key={status} className={`px-1 py-2 ${active ? "bg-blue-600 text-white" : "bg-slate-50 text-slate-400"} ${index > 0 ? "border-l border-white/40" : ""}`}>
                              {label}
                            </span>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">{statusLabel(currentStatus)}</span>
                        <button type="button" onClick={() => void finishBill(group)} disabled={groupBusy} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-800 disabled:opacity-50">
                          {groupBusy ? "กำลังบันทึก..." : "พร้อมเสิร์ฟทั้งบิล"}
                        </button>
                      </div>
                    </header>

                    <div className="grid min-h-0 content-start gap-3 overflow-y-auto bg-slate-50 p-3">
                      {group.tickets.map((ticket) => {
                        const ticketBusy = busyKeys.has(`ticket:${ticket.id}`) || groupBusy;
                        const previous = previousStatus(ticket.status);
                        const next = nextStatus(ticket.status);
                        return (
                          <section key={ticket.id} className={`rounded-xl border bg-white p-4 shadow-sm ${ticket.status === "queued" ? "border-amber-300 ring-2 ring-amber-100" : "border-slate-200"}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">{eventLabel(ticket)}</span>
                                <p className="mt-2 text-xs font-bold text-slate-500">รอบที่ {ticket.round_no ?? 1} · {ageText(ticket.created_at, now)}</p>
                              </div>
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">{statusLabel(ticket.status)}</span>
                            </div>
                            <div className="mt-4 grid gap-2">
                              {ticket.items.map((item) => (
                                <div key={item.id} className="flex items-start justify-between gap-3 border-t border-slate-100 pt-2 first:border-0 first:pt-0">
                                  <div>
                                    <span className="font-black">{item.product_name}</span>
                                    {item.notes ? <small className="block text-xs font-semibold text-orange-600">{item.notes}</small> : null}
                                  </div>
                                  <strong className="text-lg">x{item.quantity}</strong>
                                </div>
                              ))}
                            </div>
                            {ticket.order_notes ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">หมายเหตุ: {ticket.order_notes}</p> : null}
                            <div className="mt-4 grid grid-cols-2 gap-2">
                              {previous ? (
                                <button type="button" onClick={() => void transition(ticket, previous)} disabled={ticketBusy} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-black text-slate-700 disabled:opacity-50">
                                  ย้อนกลับ
                                </button>
                              ) : <span />}
                              {next ? (
                                <button type="button" onClick={() => void transition(ticket, next)} disabled={ticketBusy} className={`rounded-lg px-3 py-2.5 text-sm font-black text-white disabled:opacity-50 ${next === "ready" ? "bg-emerald-600" : "bg-blue-600"}`}>
                                  {ticketBusy ? "กำลังบันทึก..." : nextLabel(ticket.status)}
                                </button>
                              ) : <span />}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
