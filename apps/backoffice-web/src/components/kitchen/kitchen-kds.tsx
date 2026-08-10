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
  status: KitchenStatus;
  created_at: string;
  zone: { id: string; zone_code: string; zone_name: string } | null;
  items: KitchenItem[];
  print_jobs: Array<{ id: string; status: string; last_error: string | null }>;
};

type QueueResponse = { data?: { tickets?: KitchenTicket[] }; error?: { message?: string } };
type ItemPhase = "pending" | "accepted" | "cleared";
type TicketGroup = { key: string; tickets: KitchenTicket[] };

function ageText(createdAt: string, now: number) {
  const ms = Math.max(0, now - new Date(createdAt).getTime());
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "เมื่อสักครู่";
  if (minutes < 60) return `${minutes} นาที`;
  return `${Math.floor(minutes / 60)} ชม. ${minutes % 60} นาที`;
}

function initialItemPhase(status: KitchenStatus): ItemPhase {
  if (status === "ready" || status === "cancelled") return "cleared";
  if (status === "acknowledged" || status === "preparing") return "accepted";
  return "pending";
}

function itemKey(ticketId: string, itemId: string) {
  return `${ticketId}:${itemId}`;
}

function orderTypeLabel(orderType: string) {
  const normalized = orderType.toLowerCase();
  if (normalized.includes("dine") || normalized.includes("table")) return "นั่งโต๊ะ";
  if (normalized.includes("take")) return "กลับบ้าน";
  if (normalized.includes("delivery")) return "เดลิเวอรี";
  return orderType || "ออเดอร์";
}

export function KitchenKds() {
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [itemPhases, setItemPhases] = useState<Record<string, ItemPhase>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const inFlightRef = useRef(false);
  const boardRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (silent = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/pos/kitchen/queue?status=queued,acknowledged,preparing,ready&limit=100", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as QueueResponse | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? "โหลดคิวครัวไม่สำเร็จ");
      const nextTickets = body.data.tickets ?? [];
      setTickets(nextTickets);
      setItemPhases((current) => {
        const next = { ...current };
        for (const ticket of nextTickets) {
          for (const item of ticket.items) {
            const key = itemKey(ticket.id, item.id);
            if (!next[key]) next[key] = initialItemPhase(ticket.status);
          }
        }
        return next;
      });
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

  const groups = useMemo<TicketGroup[]>(() => {
    const grouped = new Map<string, KitchenTicket[]>();
    const orderedTickets = [...tickets]
      .filter((ticket) => ticket.status !== "cancelled")
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    for (const ticket of orderedTickets) {
      const key = ticket.table_id ? `table:${ticket.table_id}` : `order:${ticket.order_id}`;
      const rows = grouped.get(key) ?? [];
      rows.push(ticket);
      grouped.set(key, rows);
    }

    return Array.from(grouped, ([key, rows]) => ({ key, tickets: rows })).filter((group) =>
      group.tickets.some((ticket) =>
        ticket.items.some((item) => (itemPhases[itemKey(ticket.id, item.id)] ?? initialItemPhase(ticket.status)) !== "cleared")
      )
    );
  }, [itemPhases, tickets]);

  const counters = useMemo(() => {
    let active = 0;
    let accepted = 0;
    let partialBills = 0;

    for (const group of groups) {
      let total = 0;
      let cleared = 0;
      for (const ticket of group.tickets) {
        for (const item of ticket.items) {
          total += 1;
          const phase = itemPhases[itemKey(ticket.id, item.id)] ?? initialItemPhase(ticket.status);
          if (phase === "cleared") cleared += 1;
          else {
            active += 1;
            if (phase === "accepted") accepted += 1;
          }
        }
      }
      if (cleared > 0 && cleared < total) partialBills += 1;
    }

    return { active, accepted, partialBills };
  }, [groups, itemPhases]);

  function advanceItem(ticket: KitchenTicket, item: KitchenItem) {
    const key = itemKey(ticket.id, item.id);
    setItemPhases((current) => {
      const phase = current[key] ?? initialItemPhase(ticket.status);
      const nextPhase: ItemPhase = phase === "pending" ? "accepted" : "cleared";
      return { ...current, [key]: nextPhase };
    });
  }

  function scrollBoard(direction: -1 | 1) {
    boardRef.current?.scrollBy({ left: direction * 420, behavior: "smooth" });
  }

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-100 text-slate-900">
      <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-black">ครัว · Kitchen Display</h1>
            <p className="mt-1 text-sm text-slate-500">บิลออเดอร์เรียงตามเวลาที่เข้าครัว · อัปเดตอัตโนมัติทุก 3 วินาที</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="rounded-full bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700">ค้าง {counters.active}</span>
            <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">รับแล้ว {counters.accepted}</span>
            {counters.partialBills > 0 ? <span className="rounded-full bg-orange-50 px-3 py-1.5 text-xs font-bold text-orange-700">เคลียร์บางส่วน {counters.partialBills} บิล</span> : null}
            <button type="button" onClick={() => void load()} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold shadow-sm hover:bg-slate-50">รีเฟรช</button>
          </div>
        </div>
      </header>

      {error ? <div className="mx-5 mt-3 shrink-0 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

      {loading ? (
        <div className="grid flex-1 place-items-center text-sm font-semibold text-slate-500">กำลังโหลดคิวครัว...</div>
      ) : groups.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center p-6">
          <div className="max-w-md rounded-2xl border border-dashed border-slate-300 bg-white px-8 py-10 text-center shadow-sm">
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-xl">✓</div>
            <p className="font-black text-slate-800">ยังไม่มีบิลค้างในครัว</p>
            <p className="mt-1 text-sm text-slate-500">เมื่อมีออเดอร์เข้าครัว บิลจะแสดงเรียงจากซ้ายไปขวาที่หน้านี้</p>
          </div>
        </div>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-between px-4 pt-3">
            <button type="button" aria-label="เลื่อนบิลไปทางซ้าย" onClick={() => scrollBoard(-1)} className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white/95 text-xl font-black shadow-md backdrop-blur hover:bg-white">‹</button>
            <button type="button" aria-label="เลื่อนบิลไปทางขวา" onClick={() => scrollBoard(1)} className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full border border-slate-200 bg-white/95 text-xl font-black shadow-md backdrop-blur hover:bg-white">›</button>
          </div>

          <div ref={boardRef} className="flex h-full min-h-0 snap-x snap-mandatory gap-4 overflow-x-auto overflow-y-hidden px-5 pb-5 pt-16">
            {groups.map((group) => {
              const first = group.tickets[0];
              const allItems = group.tickets.flatMap((ticket) => ticket.items.map((item) => ({ ticket, item })));
              const clearedCount = allItems.filter(({ ticket, item }) => (itemPhases[itemKey(ticket.id, item.id)] ?? initialItemPhase(ticket.status)) === "cleared").length;
              const activeCount = allItems.length - clearedCount;
              const isPartial = clearedCount > 0;
              const oldestCreatedAt = first.created_at;
              const accentClass = isPartial ? "border-orange-400 bg-orange-500" : "border-red-400 bg-red-600";
              const surfaceClass = isPartial ? "border-orange-200" : "border-red-200";

              return (
                <article key={group.key} className={`flex h-full min-h-[430px] w-[340px] min-w-[340px] max-w-[340px] snap-start flex-col overflow-hidden rounded-2xl border bg-white shadow-lg ${surfaceClass}`}>
                  <header className={`shrink-0 border-b px-4 py-3 text-white ${accentClass}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <strong className="truncate text-lg">#{first.order_no}</strong>
                          <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-bold">{orderTypeLabel(first.order_type)}</span>
                        </div>
                        <p className="mt-0.5 truncate text-xs font-semibold text-white/85">{first.customer_name || first.zone?.zone_name || "ครัว"}</p>
                      </div>
                      <span className="shrink-0 rounded-lg bg-black/15 px-2 py-1 text-[11px] font-black">{ageText(oldestCreatedAt, now)}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 text-xs font-bold">
                      <span>{isPartial ? "เคลียร์บางส่วน" : "ยังไม่เคลียร์"}</span>
                      <span>เหลือ {activeCount}/{allItems.length} รายการ</span>
                    </div>
                  </header>

                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white">
                    {group.tickets.map((ticket, ticketIndex) => {
                      const visibleItems = ticket.items.filter((item) => (itemPhases[itemKey(ticket.id, item.id)] ?? initialItemPhase(ticket.status)) !== "cleared");
                      if (visibleItems.length === 0) return null;

                      return (
                        <section key={ticket.id} className={ticketIndex > 0 ? "border-t-4 border-orange-100" : ""}>
                          {ticketIndex > 0 ? (
                            <div className="flex items-center justify-between bg-orange-50 px-4 py-2 text-xs font-black text-orange-700">
                              <span>+ เพิ่มรายการอาหาร</span>
                              <span>{ageText(ticket.created_at, now)}</span>
                            </div>
                          ) : null}

                          <div className="divide-y divide-slate-100">
                            {visibleItems.map((item) => {
                              const phase = itemPhases[itemKey(ticket.id, item.id)] ?? initialItemPhase(ticket.status);
                              return (
                                <div key={item.id} className="px-4 py-3">
                                  <div className="flex items-start gap-3">
                                    <span className="grid h-8 min-w-8 place-items-center rounded-lg bg-slate-100 px-2 text-sm font-black text-slate-700">×{item.quantity}</span>
                                    <div className="min-w-0 flex-1">
                                      <p className="font-black leading-5 text-slate-900">{item.product_name}</p>
                                      {item.notes ? <p className="mt-1 text-xs font-semibold leading-4 text-orange-600">{item.notes}</p> : null}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => advanceItem(ticket, item)}
                                    className={`mt-3 w-full rounded-xl px-3 py-2.5 text-sm font-black shadow-sm transition active:scale-[0.99] ${phase === "pending" ? "bg-slate-900 text-white hover:bg-slate-800" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
                                  >
                                    {phase === "pending" ? "รับออเดอร์" : "พร้อมเสิร์ฟ"}
                                  </button>
                                </div>
                              );
                            })}
                          </div>

                          {ticket.order_notes ? <div className="mx-4 mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800">หมายเหตุ: {ticket.order_notes}</div> : null}
                        </section>
                      );
                    })}
                  </div>

                  <footer className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-semibold text-slate-500">
                    แตะทีละรายการ: รับออเดอร์ → พร้อมเสิร์ฟ → เคลียร์ออกจากบิล
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
