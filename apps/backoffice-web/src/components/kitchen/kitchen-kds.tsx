"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppLanguage } from "@/lib/app-language-client";

type KitchenStatus = "queued" | "acknowledged" | "preparing" | "ready" | "cancelled";
type KitchenItem = { id: string; order_item_id: string | null; product_name: string; quantity: number; notes: string | null; action: string };
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

type KitchenAlertSettings = { popup_enabled: boolean; sound_enabled: boolean; sound_volume: number };
type QueueResponse = { data?: { tickets?: KitchenTicket[]; kitchen_alert_settings?: KitchenAlertSettings }; error?: { message?: string } };
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

const KITCHEN_QUEUE_REQUEST_TIMEOUT_MS = 12_000;
const ACTIVE_POLL_INTERVAL_MS = 3_000;
const IDLE_POLL_INTERVAL_MS = 8_000;
const HIDDEN_POLL_INTERVAL_MS = 20_000;
const MAX_ERROR_POLL_INTERVAL_MS = 30_000;
const SEEN_TICKET_LIMIT = 300;
const ALERT_EVENT_TYPES = new Set(["new", "add"]);
const DEFAULT_KITCHEN_ALERTS: KitchenAlertSettings = { popup_enabled: true, sound_enabled: true, sound_volume: 1 };
const INITIAL_ALERT_RECENCY_MS = 20_000;
const ACTIVE_STATUSES: KitchenStatus[] = ["queued", "acknowledged", "preparing"];
const KITCHEN_STATUS_STEPS: KitchenStatus[] = ["queued", "acknowledged", "preparing", "ready"];

const KDS_TEXT = {
  th: {
    waitingShort: "รอรับ", acknowledged: "รับแล้ว", preparing: "กำลังทำ", ready: "พร้อมเสิร์ฟ", cancelled: "ยกเลิก",
    waitingOrder: "รอรับออเดอร์", receiveOrder: "รับออเดอร์", startCooking: "เริ่มทำ", newItems: "เพิ่มรายการ",
    reprint: "พิมพ์ซ้ำ", newOrder: "ออเดอร์ใหม่", dineIn: "ทานที่ร้าน", tableQr: "QR โต๊ะ", takeaway: "กลับบ้าน",
    delivery: "เดลิเวอรี", justNow: "เมื่อสักครู่", minute: "นาที", hour: "ชม.", openKitchen: "เปิดจอครัว",
    kitchenIdHint: "ใส่ Kitchen ID 6 หลักเพื่อเปิดเฉพาะโซนครัวนี้", opening: "กำลังเปิด...", kitchenDisplay: "Kitchen Display",
    online: "ครัวออนไลน์", reconnecting: "กำลังเชื่อมต่อใหม่", pendingBills: "บิลค้าง", refreshing: "กำลังรีเฟรช...",
    refresh: "รีเฟรช", enableSound: "แตะเพื่อเปิดเสียงแจ้งเตือนออเดอร์ใหม่", newOrderAlert: "มีออเดอร์ใหม่",
    items: "รายการ", alertHint: "แจ้งเตือนพร้อมเสียงจนกว่าจะกดรับทราบ", close: "ปิด", queue: "คิว", round: "รอบ",
    table: "โต๊ะ", bill: "บิล", mode: "โหมด", acknowledge: "รับทราบ", staleData: "ระบบยังคงแสดงข้อมูลล่าสุดและจะลองใหม่อัตโนมัติ",
    loadingQueue: "กำลังโหลดคิวครัว...", noOrders: "ไม่มีออเดอร์ครัวค้าง", saving: "กำลังบันทึก...", readyWholeBill: "พร้อมเสิร์ฟทั้งบิล",
    roundNo: "รอบที่", foodItems: "รายการอาหาร", note: "หมายเหตุ", back: "ย้อนกลับ", loadFailed: "โหลดคิวครัวไม่สำเร็จ",
    openFailed: "เปิดจอครัวไม่สำเร็จ", statusFailed: "เปลี่ยนสถานะไม่สำเร็จ", billFailed: "อัปเดตทั้งบิลไม่สำเร็จ"
  },
  en: {
    waitingShort: "Waiting", acknowledged: "Accepted", preparing: "Preparing", ready: "Ready", cancelled: "Cancelled",
    waitingOrder: "Waiting for order", receiveOrder: "Accept order", startCooking: "Start cooking", newItems: "Added items",
    reprint: "Reprint", newOrder: "New order", dineIn: "Dine in", tableQr: "Table QR", takeaway: "Takeaway",
    delivery: "Delivery", justNow: "Just now", minute: "min", hour: "hr", openKitchen: "Open Kitchen Display",
    kitchenIdHint: "Enter the 6-digit Kitchen ID for this kitchen zone.", opening: "Opening...", kitchenDisplay: "Kitchen Display",
    online: "Kitchen online", reconnecting: "Reconnecting", pendingBills: "Pending bills", refreshing: "Refreshing...",
    refresh: "Refresh", enableSound: "Tap to enable new-order alert sound", newOrderAlert: "New order",
    items: "items", alertHint: "The alert sound continues until acknowledged.", close: "Close", queue: "Queue", round: "Round",
    table: "Table", bill: "Bill", mode: "Mode", acknowledge: "Acknowledge", staleData: "Showing the latest data and retrying automatically.",
    loadingQueue: "Loading kitchen queue...", noOrders: "No pending kitchen orders", saving: "Saving...", readyWholeBill: "Mark whole bill ready",
    roundNo: "Round", foodItems: "Food items", note: "Note", back: "Back", loadFailed: "Failed to load kitchen queue",
    openFailed: "Failed to open kitchen display", statusFailed: "Failed to change status", billFailed: "Failed to update the whole bill"
  },
  lo: {
    waitingShort: "ລໍຖ້າຮັບ", acknowledged: "ຮັບແລ້ວ", preparing: "ກຳລັງເຮັດ", ready: "ພ້ອມເສີບ", cancelled: "ຍົກເລີກ",
    waitingOrder: "ລໍຖ້າຮັບອໍເດີ", receiveOrder: "ຮັບອໍເດີ", startCooking: "ເລີ່ມເຮັດ", newItems: "ເພີ່ມລາຍການ",
    reprint: "ພິມຊ້ຳ", newOrder: "ອໍເດີໃໝ່", dineIn: "ກິນທີ່ຮ້ານ", tableQr: "QR ໂຕະ", takeaway: "ກັບບ້ານ",
    delivery: "ຈັດສົ່ງ", justNow: "ເມື່ອກີ້", minute: "ນາທີ", hour: "ຊມ.", openKitchen: "ເປີດຈໍຄົວ",
    kitchenIdHint: "ໃສ່ Kitchen ID 6 ຫຼັກເພື່ອເປີດໂຊນຄົວນີ້", opening: "ກຳລັງເປີດ...", kitchenDisplay: "Kitchen Display",
    online: "ຄົວອອນລາຍ", reconnecting: "ກຳລັງເຊື່ອມຕໍ່ໃໝ່", pendingBills: "ບິນຄ້າງ", refreshing: "ກຳລັງໂຫຼດ...",
    refresh: "ໂຫຼດໃໝ່", enableSound: "ແຕະເພື່ອເປີດສຽງແຈ້ງອໍເດີໃໝ່", newOrderAlert: "ມີອໍເດີໃໝ່",
    items: "ລາຍການ", alertHint: "ສຽງແຈ້ງເຕືອນຈະດັງຈົນກວ່າຈະກົດຮັບຮູ້", close: "ປິດ", queue: "ຄິວ", round: "ຮອບ",
    table: "ໂຕະ", bill: "ບິນ", mode: "ໂໝດ", acknowledge: "ຮັບຮູ້", staleData: "ລະບົບຍັງສະແດງຂໍ້ມູນລ່າສຸດ ແລະຈະລອງໃໝ່ອັດຕະໂນມັດ",
    loadingQueue: "ກຳລັງໂຫຼດຄິວຄົວ...", noOrders: "ບໍ່ມີອໍເດີຄົວຄ້າງ", saving: "ກຳລັງບັນທຶກ...", readyWholeBill: "ພ້ອມເສີບທັງບິນ",
    roundNo: "ຮອບທີ", foodItems: "ລາຍການອາຫານ", note: "ໝາຍເຫດ", back: "ຍ້ອນກັບ", loadFailed: "ໂຫຼດຄິວຄົວບໍ່ສຳເລັດ",
    openFailed: "ເປີດຈໍຄົວບໍ່ສຳເລັດ", statusFailed: "ປ່ຽນສະຖານະບໍ່ສຳເລັດ", billFailed: "ອັບເດດທັງບິນບໍ່ສຳເລັດ"
  }
} as const;

type KdsTextKey = keyof typeof KDS_TEXT.th;
const kt = (lang: AppLanguage, key: KdsTextKey) => KDS_TEXT[lang][key];

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

function ageText(createdAt: string, now: number, lang: AppLanguage) {
  const ms = Math.max(0, now - new Date(createdAt).getTime());
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return kt(lang, "justNow");
  if (minutes < 60) return `${minutes} ${kt(lang, "minute")}`;
  return `${Math.floor(minutes / 60)} ${kt(lang, "hour")} ${minutes % 60} ${kt(lang, "minute")}`;
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

function nextLabel(status: KitchenStatus, lang: AppLanguage) {
  if (status === "queued") return kt(lang, "receiveOrder");
  if (status === "acknowledged") return kt(lang, "startCooking");
  if (status === "preparing") return kt(lang, "ready");
  return "";
}

function statusLabel(status: KitchenStatus, lang: AppLanguage, short = false) {
  if (status === "queued") return kt(lang, short ? "waitingShort" : "waitingOrder");
  if (status === "acknowledged") return kt(lang, "acknowledged");
  if (status === "preparing") return kt(lang, "preparing");
  if (status === "ready") return kt(lang, "ready");
  return kt(lang, "cancelled");
}

function statusRank(status: KitchenStatus) {
  if (status === "queued") return 0;
  if (status === "acknowledged") return 1;
  if (status === "preparing") return 2;
  if (status === "ready") return 3;
  return -1;
}


function statusStepClass(status: KitchenStatus, active: boolean) {
  if (!active) return "bg-slate-50 text-slate-400";
  if (status === "queued") return "bg-amber-500 text-white";
  if (status === "acknowledged") return "bg-red-600 text-white";
  if (status === "preparing") return "bg-orange-500 text-white";
  if (status === "ready") return "bg-emerald-600 text-white";
  return "bg-slate-500 text-white";
}

function statusBadgeClass(status: KitchenStatus) {
  if (status === "queued") return "bg-amber-50 text-amber-800 ring-1 ring-amber-200";
  if (status === "acknowledged") return "bg-red-50 text-red-700 ring-1 ring-red-200";
  if (status === "preparing") return "bg-orange-50 text-orange-700 ring-1 ring-orange-200";
  if (status === "ready") return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
}

function ticketCardClass(status: KitchenStatus) {
  if (status === "queued") return "border-amber-300 ring-2 ring-amber-100";
  if (status === "acknowledged") return "border-red-300 ring-2 ring-red-100";
  if (status === "preparing") return "border-orange-300 ring-2 ring-orange-100";
  return "border-slate-200";
}

function nextButtonClass(status: KitchenStatus) {
  if (status === "queued") return "bg-red-600 hover:bg-red-700";
  if (status === "acknowledged") return "bg-orange-500 hover:bg-orange-600";
  if (status === "preparing") return "bg-emerald-600 hover:bg-emerald-700";
  return "bg-slate-600 hover:bg-slate-700";
}

function groupStatus(tickets: KitchenTicket[]) {
  if (tickets.some((ticket) => ticket.status === "queued")) return "queued" as KitchenStatus;
  if (tickets.some((ticket) => ticket.status === "acknowledged")) return "acknowledged" as KitchenStatus;
  if (tickets.some((ticket) => ticket.status === "preparing")) return "preparing" as KitchenStatus;
  return "ready" as KitchenStatus;
}

function eventLabel(ticket: KitchenTicket, lang: AppLanguage) {
  if (ticket.event_type === "add" || (ticket.round_no ?? 1) > 1) return kt(lang, "newItems");
  if (ticket.event_type === "reprint") return kt(lang, "reprint");
  return kt(lang, "newOrder");
}

function orderTypeLabel(orderType: string, lang: AppLanguage) {
  if (orderType === "dine_in") return kt(lang, "dineIn");
  if (orderType === "table_qr" || orderType === "qr_table") return kt(lang, "tableQr");
  if (orderType === "takeaway") return kt(lang, "takeaway");
  if (orderType === "delivery") return kt(lang, "delivery");
  return orderType || "POS";
}

function formatKitchenClock(now: number, lang: AppLanguage) {
  const locale = lang === "lo" ? "lo-LA" : lang === "en" ? "en-US" : "th-TH";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: lang === "lo" ? "Asia/Vientiane" : "Asia/Bangkok" }).format(new Date(now));
}

export function KitchenKds({ defaultLanguage = "th" }: { defaultLanguage?: AppLanguage }) {
  const lang = defaultLanguage;
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
  const [kitchenAlerts, setKitchenAlerts] = useState<KitchenAlertSettings>(DEFAULT_KITCHEN_ALERTS);
  const [soundArmed, setSoundArmed] = useState(false);
  const kitchenAlertsRef = useRef<KitchenAlertSettings>(DEFAULT_KITCHEN_ALERTS);
  const initialLoadedRef = useRef(false);

  const inFlightRef = useRef(false);
  const activeTicketCountRef = useRef(0);
  const loadFailedRef = useRef(false);
  const queueAbortRef = useRef<AbortController | null>(null);
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
      audio.volume = kitchenAlertsRef.current.sound_volume;
      setSoundArmed(true);
      setAlertState((current) => ({ ...current, soundBlocked: false }));
    } catch {
      audio.volume = kitchenAlertsRef.current.sound_volume;
      setSoundArmed(false);
      setAlertState((current) => ({ ...current, soundBlocked: true }));
    }
  }, []);

  const playAlertSound = useCallback((repeat: boolean) => {
    const settings = kitchenAlertsRef.current;
    if (!settings.sound_enabled || settings.sound_volume <= 0) {
      stopAlertSound();
      return;
    }
    if (!audioRef.current) audioRef.current = new Audio("/sounds/kitchen-alert.wav");
    const audio = audioRef.current;
    audio.preload = "auto";
    audio.loop = false;
    audio.volume = settings.sound_volume;
    const playOnce = () => {
      audio.currentTime = 0;
      void audio.play()
        .then(() => { setSoundArmed(true); setAlertState((current) => ({ ...current, soundBlocked: false })); })
        .catch(() => { setSoundArmed(false); setAlertState((current) => ({ ...current, soundBlocked: true })); });
    };
    stopAlertSound();
    playOnce();
    if (repeat) audioLoopTimerRef.current = window.setInterval(playOnce, 2400);
  }, [stopAlertSound]);

  const showNewTicketAlert = useCallback((ticket: KitchenTicket, increment: number) => {
    const settings = kitchenAlertsRef.current;
    if (settings.popup_enabled) {
      setAlertState((current) => ({
        open: true,
        count: current.open ? current.count + increment : increment,
        latest: ticket,
        soundBlocked: current.soundBlocked
      }));
    }
    if (settings.sound_enabled) playAlertSound(settings.popup_enabled);
  }, [playAlertSound]);

  const applyTickets = useCallback((nextTickets: KitchenTicket[]) => {
    const alertable = nextTickets.filter((ticket) => shouldAlertTicket(ticket) && ticket.zone?.id === unlockedZone?.id);
    if (!baselineReadyRef.current) {
      for (const ticket of alertable) seenAlertKeysRef.current.add(ticketAlertKey(ticket));
      trimSeenSet(seenAlertKeysRef.current);
      baselineReadyRef.current = true;
      activeTicketCountRef.current = nextTickets.length;
      setTickets(nextTickets);
      // Cold Kitchen opens should still alert for just-submitted tickets, not stale historical orders.
      const recent = alertable.filter((ticket) => ticket.status === "queued"
        && Date.now() - new Date(ticket.created_at).getTime() <= INITIAL_ALERT_RECENCY_MS);
      if (recent.length > 0) showNewTicketAlert(recent[recent.length - 1], recent.length);
      return;
    }

    const fresh = alertable.filter((ticket) => {
      const key = ticketAlertKey(ticket);
      if (seenAlertKeysRef.current.has(key)) return false;
      seenAlertKeysRef.current.add(key);
      return true;
    });
    trimSeenSet(seenAlertKeysRef.current);
    activeTicketCountRef.current = nextTickets.length;
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
    if (!silent && !initialLoadedRef.current) setLoading(true);
    const controller = new AbortController();
    queueAbortRef.current = controller;
    let timedOut = false;
    // A stalled network request must never lock the Kitchen queue behind
    // inFlightRef indefinitely. Abort only the read-only queue request.
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, KITCHEN_QUEUE_REQUEST_TIMEOUT_MS);
    try {
      const params = new URLSearchParams({ status: ACTIVE_STATUSES.join(","), limit: "100", zone_id: unlockedZone.id });
      const response = await fetch(`/api/pos/kitchen/queue?${params.toString()}`, { cache: "no-store", signal: controller.signal });
      const body = (await response.json().catch(() => null)) as QueueResponse | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? kt(lang, "loadFailed"));
      loadFailedRef.current = false;
      const nextSettings = body.data.kitchen_alert_settings ?? DEFAULT_KITCHEN_ALERTS;
      kitchenAlertsRef.current = nextSettings;
      setKitchenAlerts((current) => current.popup_enabled === nextSettings.popup_enabled
        && current.sound_enabled === nextSettings.sound_enabled && current.sound_volume === nextSettings.sound_volume ? current : nextSettings);
      if (!nextSettings.sound_enabled || nextSettings.sound_volume <= 0) stopAlertSound();
      if (!nextSettings.popup_enabled) setAlertState((current) => current.open ? { ...current, open: false, count: 0 } : current);
      applyTickets(body.data.tickets ?? []);
      setError(null);
      setInitialLoaded(true);
      initialLoadedRef.current = true;
    } catch (loadError) {
      // Component teardown or switching Kitchen zones is intentional; a
      // timed-out request, however, is a failed poll and must back off/retry.
      if (controller.signal.aborted && !timedOut) return;
      loadFailedRef.current = true;
      setError(timedOut ? kt(lang, "loadFailed")
        : loadError instanceof Error ? loadError.message : kt(lang, "loadFailed"));
    } finally {
      window.clearTimeout(timeoutId);
      if (queueAbortRef.current === controller) {
        queueAbortRef.current = null;
        inFlightRef.current = false;
      }
      if (!silent && (!controller.signal.aborted || timedOut)) setLoading(false);
    }
  }, [applyTickets, stopAlertSound, unlockedZone?.id]);

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
      if (!response.ok || !body?.data?.zone) throw new Error(body?.error?.message ?? kt(lang, "openFailed"));
      baselineReadyRef.current = false;
      seenAlertKeysRef.current = new Set();
      closeAlert();
      setTickets([]);
      setInitialLoaded(false);
      initialLoadedRef.current = false;
      setUnlockedZone(body.data.zone);
      setAccessCode("");
      setError(null);
      await armAlertSound();
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : kt(lang, "openFailed"));
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
    let disposed = false;
    let pollTimer: number | null = null;
    let errorStreak = 0;

    const scheduleNextPoll = (delayMs: number) => {
      if (disposed) return;
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      pollTimer = window.setTimeout(() => {
        void pollQueue();
      }, delayMs);
    };

    const pollQueue = async () => {
      if (disposed) return;
      if (document.visibilityState !== "visible") {
        scheduleNextPoll(HIDDEN_POLL_INTERVAL_MS);
        return;
      }

      await load(true);
      if (disposed) return;
      if (loadFailedRef.current) errorStreak = Math.min(errorStreak + 1, 4);
      else errorStreak = 0;

      const baseDelay = activeTicketCountRef.current > 0 ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS;
      const nextDelay = loadFailedRef.current
        ? Math.min(baseDelay * 2 ** Math.max(1, errorStreak), MAX_ERROR_POLL_INTERVAL_MS)
        : baseDelay;
      scheduleNextPoll(nextDelay);
    };

    void load(false).finally(() => {
      if (!disposed) {
        scheduleNextPoll(activeTicketCountRef.current > 0 ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS);
      }
    });

    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    const onFocus = () => {
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      void pollQueue();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        if (pollTimer !== null) window.clearTimeout(pollTimer);
        void pollQueue();
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      disposed = true;
      if (pollTimer !== null) window.clearTimeout(pollTimer);
      queueAbortRef.current?.abort();
      queueAbortRef.current = null;
      window.clearInterval(clock);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
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
    if (!response.ok) throw new Error(body?.error?.message ?? kt(lang, "statusFailed"));
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
      void load(true);
      setError(null);
    } catch (transitionError) {
      setTickets((current) => current.map((row) => (row.id === ticket.id ? { ...row, status: previous } : row)));
      setError(transitionError instanceof Error ? transitionError.message : kt(lang, "statusFailed"));
    } finally {
      setBusy(busyKey, false);
    }
  }

  async function cancelItem(ticket: KitchenTicket, item: KitchenItem) {
    const busyKey = `item:${item.id}`;
    if (busyKeys.has(busyKey)) return;
    const previousTickets = tickets;
    setBusy(busyKey, true);
    setTickets((current) => current
      .map((row) => row.id === ticket.id ? { ...row, items: row.items.filter((candidate) => candidate.id !== item.id) } : row)
      .filter((row) => row.items.length > 0));
    try {
      const response = await fetch(`/api/pos/kitchen/tickets/${ticket.id}/items/${item.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "kds_item_cancel" })
      });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "Kitchen item cancellation failed.");
      await load(true);
      setError(null);
    } catch (cancelError) {
      setTickets(previousTickets);
      setError(cancelError instanceof Error ? cancelError.message : "Kitchen item cancellation failed.");
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
      // One ticket can succeed even if another fails. Promise.all would reject
      // early, then restoring every optimistic status would falsely display
      // already-completed tickets as pending (risking a duplicate Kitchen action).
      const results = await Promise.allSettled(
        group.tickets.map((ticket) => setTicketStatusRemote(ticket, "ready"))
      );
      const completedIds = new Set(group.tickets
        .filter((_, index) => results[index].status === "fulfilled")
        .map((ticket) => ticket.id));
      setTickets((current) => current
        .filter((row) => !completedIds.has(row.id))
        .map((row) => {
          const originalStatus = previous.get(row.id);
          return originalStatus ? { ...row, status: originalStatus } : row;
        }));
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected?.status === "rejected") {
        setError(rejected.reason instanceof Error ? rejected.reason.message : kt(lang, "billFailed"));
      } else {
        setError(null);
      }
      // Re-read the server's authoritative ticket state after partial success.
      void load(true);
    } catch (finishError) {
      setError(finishError instanceof Error ? finishError.message : kt(lang, "billFailed"));
      void load(true);
    } finally {
      setBusy(busyKey, false);
    }
  }

  if (!unlockedZone) {
    return (
      <section className="grid h-full min-h-0 w-full place-items-center bg-slate-100 p-4 text-slate-950">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-black">{kt(lang, "openKitchen")}</h1>
          <p className="mt-2 text-sm font-semibold text-slate-500">{kt(lang, "kitchenIdHint")}</p>
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
            {unlocking ? kt(lang, "opening") : kt(lang, "openKitchen")}
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
            <span className="text-xl font-black">{kt(lang, "kitchenDisplay")}</span>
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-500">{formatKitchenClock(now, lang)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-3 py-1.5 text-xs font-black ${isOnline ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
            {isOnline ? kt(lang, "online") : kt(lang, "reconnecting")}
          </span>
          <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700">{kt(lang, "pendingBills")} {activeBillCount}</span>
          <button type="button" onClick={() => void load(false)} disabled={loading} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-black disabled:opacity-50">
            {loading ? kt(lang, "refreshing") : kt(lang, "refresh")}
          </button>
        </div>
      </header>

      {(kitchenAlerts.sound_enabled && kitchenAlerts.sound_volume > 0 && (alertState.soundBlocked || !soundArmed)) ? (
        <button type="button" onClick={() => void armAlertSound()} className="mx-5 mt-3 shrink-0 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-black text-amber-800">
          {kt(lang, "enableSound")}
        </button>
      ) : null}

      {alertState.open && alertState.latest ? (
        <div className="fixed inset-x-3 top-4 z-[150] mx-auto max-w-lg rounded-2xl border-4 border-amber-400 bg-white p-5 text-slate-950 shadow-2xl sm:top-8" role="alertdialog" aria-live="assertive">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-2xl font-black">{kt(lang, "newOrderAlert")}{alertState.count > 1 ? ` ${alertState.count} ${kt(lang, "items")}` : ""}</h2>
              <p className="mt-1 text-sm font-bold text-slate-600">{kitchenAlerts.sound_enabled ? kt(lang, "alertHint") : (lang === "th" ? "แสดงแจ้งเตือนโดยไม่มีเสียง" : lang === "lo" ? "ແຈ້ງເຕືອນໂດຍບໍ່ມີສຽງ" : "Visual alert without sound")}</p>
            </div>
            <button type="button" onClick={closeAlert} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-black">{kt(lang, "close")}</button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-lg font-black">
            <div className="rounded-lg bg-slate-100 p-3">{kt(lang, "queue")}<br /><span className="text-3xl">{String(alertState.latest.queue_no ?? "-").padStart(2, "0")}</span></div>
            <div className="rounded-lg bg-slate-100 p-3">{kt(lang, "round")}<br /><span className="text-3xl">{alertState.latest.round_no ?? 1}</span></div>
            <div className="rounded-lg bg-slate-100 p-3">{kt(lang, "table")}<br /><span>{alertState.latest.table_id ?? "-"}</span></div>
            <div className="rounded-lg bg-slate-100 p-3">{kt(lang, "bill")}<br /><span>{alertState.latest.order_no}</span></div>
            <div className="col-span-2 rounded-lg bg-slate-100 p-3">{kt(lang, "mode")}: {orderTypeLabel(alertState.latest.order_type, lang)}</div>
          </div>
          <button type="button" onClick={closeAlert} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-4 text-lg font-black text-white">{kt(lang, "acknowledge")}</button>
        </div>
      ) : null}

      {error ? <div className="mx-5 mt-3 shrink-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{error} — {kt(lang, "staleData")}</div> : null}

      {!initialLoaded && loading ? (
        <div className="grid flex-1 place-items-center text-sm font-semibold text-slate-500">{kt(lang, "loadingQueue")}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
          {billGroups.length === 0 ? (
            <div className="grid h-full place-items-center bg-slate-50 text-sm font-bold text-slate-400">{kt(lang, "noOrders")}</div>
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
                          <p className="text-xs font-black uppercase text-slate-500">{kt(lang, "bill")} {group.orderNo}</p>
                          <h2 className="mt-1 truncate text-3xl font-black">{kt(lang, "table")} {group.tableId ?? "-"}</h2>
                          <p className="mt-1 text-xs font-bold text-slate-500">{orderTypeLabel(group.orderType, lang)}</p>
                        </div>
                        <div className="text-right">
                          <div className="rounded-lg bg-blue-50 px-3 py-2 text-lg font-black text-blue-700">Q{group.queueNo ?? "-"}</div>
                          <p className="mt-1 text-xs font-bold text-slate-500">{ageText(group.createdAt, now, lang)}</p>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-4 overflow-hidden rounded-lg border border-slate-200 text-center text-[11px] font-black sm:text-xs">
                        {KITCHEN_STATUS_STEPS.map((status, index) => {
                          const active = currentRank >= index;
                          return (
                            <span key={status} className={`px-1 py-2 ${statusStepClass(status, active)} ${index > 0 ? "border-l border-white/40" : ""}`}>
                              {statusLabel(status, lang, true)}
                            </span>
                          );
                        })}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className={`rounded-full px-3 py-1 text-xs font-black ${statusBadgeClass(currentStatus)}`}>{statusLabel(currentStatus, lang)}</span>
                        <button type="button" onClick={() => void finishBill(group)} disabled={groupBusy} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-800 disabled:opacity-50">
                          {groupBusy ? kt(lang, "saving") : kt(lang, "readyWholeBill")}
                        </button>
                      </div>
                    </header>

                    <div className="grid min-h-0 content-start gap-3 overflow-y-auto bg-slate-50 p-3">
                      {group.tickets.map((ticket) => {
                        const ticketBusy = busyKeys.has(`ticket:${ticket.id}`) || groupBusy;
                        const previous = previousStatus(ticket.status);
                        const next = nextStatus(ticket.status);
                        return (
                          <section key={ticket.id} className={`rounded-xl border bg-white p-4 shadow-sm ${ticketCardClass(ticket.status)}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-black text-amber-700">{eventLabel(ticket, lang)}</span>
                                <p className="mt-2 text-xs font-bold text-slate-500">{kt(lang, "roundNo")} {ticket.round_no ?? 1} · {ageText(ticket.created_at, now, lang)}</p>
                              </div>
                              <span className={`rounded-full px-2.5 py-1 text-xs font-black ${statusBadgeClass(ticket.status)}`}>{statusLabel(ticket.status, lang)}</span>
                            </div>
                            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                              <div className="mb-2 flex items-center justify-between gap-3 text-xs font-black text-slate-500">
                                <span>{kt(lang, "foodItems")}</span>
                                <span>{ticket.items.length} {kt(lang, "items")}</span>
                              </div>
                              <div className="grid gap-2">
                                {ticket.items.map((item) => (
                                  <div key={item.id} className="flex items-start justify-between gap-3 rounded-lg bg-white px-3 py-2 shadow-sm ring-1 ring-slate-100">
                                    <div>
                                      <span className="font-black">{item.product_name}</span>
                                      {item.notes ? <small className="block text-xs font-semibold text-orange-600">{item.notes}</small> : null}
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-2"><strong className="text-lg">x{item.quantity}</strong>{item.action !== "cancel" ? <button type="button" onClick={() => void cancelItem(ticket, item)} disabled={ticketBusy || busyKeys.has(`item:${item.id}`)} className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-black text-red-700 disabled:opacity-50">{kt(lang, "cancelled")}</button> : null}</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            {ticket.order_notes ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">{kt(lang, "note")}: {ticket.order_notes}</p> : null}
                            <div className="mt-4 grid grid-cols-2 gap-2">
                              {previous ? (
                                <button type="button" onClick={() => void transition(ticket, previous)} disabled={ticketBusy} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-black text-slate-700 disabled:opacity-50">
                                  {kt(lang, "back")}
                                </button>
                              ) : <span />}
                              {next ? (
                                <button type="button" onClick={() => void transition(ticket, next)} disabled={ticketBusy} className={`rounded-lg px-3 py-2.5 text-sm font-black text-white transition disabled:opacity-50 ${nextButtonClass(ticket.status)}`}>
                                  {ticketBusy ? kt(lang, "saving") : nextLabel(ticket.status, lang)}
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
