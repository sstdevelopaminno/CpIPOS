"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type KitchenStatus = "queued" | "acknowledged" | "preparing" | "ready" | "cancelled";
type KitchenItem = {
  id: string;
  product_name: string;
  quantity: number;
  notes: string | null;
  action: string;
};
type KitchenTicket = {
  id: string;
  order_id: string;
  order_no: string;
  order_type: string;
  table_id: string | null;
  customer_name: string | null;
  order_notes: string | null;
  event_type: string;
  status: KitchenStatus;
  created_at: string;
  zone: { id: string; zone_code: string; zone_name: string } | null;
  items: KitchenItem[];
  print_jobs: Array<{ id: string; status: string; last_error: string | null }>;
};

type QueueResponse = { data?: { tickets?: KitchenTicket[] }; error?: { message?: string } };

const ACTIVE_STATUSES = new Set<KitchenStatus>(["queued", "acknowledged", "preparing"]);

function ageText(createdAt: string, now: number) {
  const ms = Math.max(0, now - new Date(createdAt).getTime());
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "เมื่อสักครู่";
  if (minutes < 60) return `${minutes} นาที`;
  return `${Math.floor(minutes / 60)} ชม. ${minutes % 60} นาที`;
}

function timeText(createdAt: string) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(date);
}

function nextStatus(status: KitchenStatus): KitchenStatus | null {
  if (status === "queued") return "acknowledged";
  if (status === "acknowledged") return "preparing";
  if (status === "preparing") return "ready";
  return null;
}

function nextLabel(status: KitchenStatus) {
  if (status === "queued") return "รับออเดอร์ทั้งบิล";
  if (status === "acknowledged") return "เริ่มทำทั้งบิล";
  if (status === "preparing") return "พร้อมเสิร์ฟทั้งบิล";
  return "";
}

function statusLabel(status: KitchenStatus) {
  if (status === "queued") return "ออเดอร์ใหม่";
  if (status === "acknowledged") return "รับออเดอร์แล้ว";
  if (status === "preparing") return "กำลังทำ";
  if (status === "ready") return "พร้อมเสิร์ฟ";
  return "ยกเลิก";
}

function statusClass(status: KitchenStatus) {
  if (status === "queued") return "bg-amber-50 text-amber-700 ring-amber-200";
  if (status === "acknowledged") return "bg-blue-50 text-blue-700 ring-blue-200";
  if (status === "preparing") return "bg-violet-50 text-violet-700 ring-violet-200";
  return "bg-emerald-50 text-emerald-700 ring-emerald-200";
}

function orderTypeLabel(orderType: string) {
  const normalized = orderType.trim().toLowerCase();
  if (["dine_in", "dine-in", "dinein", "table"].includes(normalized)) return "นั่งโต๊ะ";
  if (["takeaway", "take_away", "take-away"].includes(normalized)) return "กลับบ้าน";
  if (["delivery"].includes(normalized)) return "เดลิเวอรี";
  return orderType || "หน้าขาย";
}

export function KitchenKds() {
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inFlightRef = useRef(false);
  const railRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (silent = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/pos/kitchen/queue?status=queued,acknowledged,preparing,ready&limit=100", {
        cache: "no-store"
      });
      const body = (await response.json().catch(() => null)) as QueueResponse | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? "โหลดคิวครัวไม่สำเร็จ");
      setTickets(body.data.tickets ?? []);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดคิวครัวไม่สำเร็จ");
    } finally {
      inFlightRef.current = false;
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
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
    };
  }, [load]);

  const activeTickets = useMemo(
    () =>
      tickets
        .filter((ticket) => ACTIVE_STATUSES.has(ticket.status))
        .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()),
    [tickets]
  );

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

  function scrollTickets(direction: -1 | 1) {
    const rail = railRef.current;
    if (!rail) return;
    const distance = Math.max(320, Math.min(760, Math.round(rail.clientWidth * 0.72)));
    rail.scrollBy({ left: distance * direction, behavior: "smooth" });
  }

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-100 text-slate-900">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
        <div className="min-w-0">
          <h1 className="text-xl font-black">ครัว · Kitchen Display</h1>
          <p className="mt-1 text-sm text-slate-500">บิลจากหน้าขายและ QR โต๊ะ · อัปเดตอัตโนมัติทุก 3 วินาที</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">
            บิลในครัว {activeTickets.length}
          </span>
          <button
            type="button"
            onClick={() => scrollTickets(-1)}
            aria-label="เลื่อนบิลไปทางซ้าย"
            className="grid h-10 w-10 place-items-center rounded-xl border border-slate-300 bg-white text-xl font-black text-slate-700 hover:bg-slate-50"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => scrollTickets(1)}
            aria-label="เลื่อนบิลไปทางขวา"
            className="grid h-10 w-10 place-items-center rounded-xl border border-slate-300 bg-white text-xl font-black text-slate-700 hover:bg-slate-50"
          >
            ›
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold hover:bg-slate-50"
          >
            รีเฟรช
          </button>
        </div>
      </header>

      {error ? (
        <div className="mx-5 mt-3 shrink-0 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="grid flex-1 place-items-center text-sm font-semibold text-slate-500">กำลังโหลดคิวครัว...</div>
      ) : activeTickets.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center p-6">
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-10 py-12 text-center shadow-sm">
            <p className="text-lg font-black text-slate-700">ยังไม่มีบิลที่ต้องทำ</p>
            <p className="mt-1 text-sm text-slate-400">เมื่อมีออเดอร์ใหม่ บิลจะเรียงจากซ้ายไปขวาตามเวลาที่เข้าครัว</p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 p-4">
          <div
            ref={railRef}
            className="flex h-full min-h-0 snap-x snap-mandatory gap-4 overflow-x-auto overflow-y-hidden pb-3"
          >
            {activeTickets.map((ticket) => {
              const minutes = Math.floor(Math.max(0, now - new Date(ticket.created_at).getTime()) / 60_000);
              const isLate = minutes >= 10;
              return (
                <article
                  key={ticket.id}
                  className={`flex h-full min-h-0 w-[340px] min-w-[340px] max-w-[340px] snap-start flex-col overflow-hidden rounded-2xl border bg-white shadow-sm xl:w-[360px] xl:min-w-[360px] xl:max-w-[360px] ${
                    isLate ? "border-red-300 ring-2 ring-red-100" : "border-slate-200"
                  }`}
                >
                  <header className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <strong className="truncate text-lg font-black">บิล #{ticket.order_no}</strong>
                          <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ring-1 ring-inset ${statusClass(ticket.status)}`}>
                            {statusLabel(ticket.status)}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-xs font-semibold text-slate-500">
                          {orderTypeLabel(ticket.order_type)} · {ticket.zone?.zone_name ?? "ครัว"}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <strong className="block text-sm">{timeText(ticket.created_at)}</strong>
                        <span className={`text-[11px] font-bold ${isLate ? "text-red-600" : "text-slate-400"}`}>
                          {ageText(ticket.created_at, now)}
                        </span>
                      </div>
                    </div>
                    {ticket.customer_name ? (
                      <p className="mt-2 truncate text-xs font-semibold text-slate-600">ลูกค้า: {ticket.customer_name}</p>
                    ) : null}
                  </header>

                  <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                    <div className="divide-y divide-slate-100">
                      {ticket.items.map((item, index) => (
                        <section key={item.id} className="py-3 first:pt-2">
                          <div className="flex items-start gap-3">
                            <span className="grid h-7 min-w-7 shrink-0 place-items-center rounded-lg bg-slate-100 px-1 text-xs font-black text-slate-600">
                              {index + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <strong className="break-words text-[15px] leading-5 text-slate-900">{item.product_name}</strong>
                                <strong className="shrink-0 text-base text-slate-900">×{item.quantity}</strong>
                              </div>
                              {item.notes ? (
                                <p className="mt-1 rounded-lg bg-amber-50 px-2.5 py-2 text-xs font-semibold leading-4 text-amber-800">
                                  {item.notes}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>

                  {ticket.order_notes ? (
                    <div className="mx-3 mb-2 shrink-0 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                      หมายเหตุบิล: {ticket.order_notes}
                    </div>
                  ) : null}

                  <footer className="shrink-0 border-t border-slate-200 bg-white p-3">
                    <p className="mb-2 text-center text-[11px] font-semibold text-slate-400">
                      ขั้นนี้ยังใช้สถานะระดับบิลเดิม · ปุ่มรายเมนูจะเชื่อมในขั้นระบบครัวถัดไป
                    </p>
                    <button
                      type="button"
                      onClick={() => void transition(ticket)}
                      disabled={Boolean(busyId)}
                      className="w-full rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busyId === ticket.id ? "กำลังบันทึก..." : nextLabel(ticket.status)}
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
