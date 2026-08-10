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

const COLUMNS: Array<{ status: KitchenStatus; label: string; empty: string }> = [
  { status: "queued", label: "รายการใหม่", empty: "ยังไม่มีรายการใหม่" },
  { status: "acknowledged", label: "รับแล้ว", empty: "ยังไม่มีรายการที่รับแล้ว" },
  { status: "preparing", label: "กำลังทำ", empty: "ยังไม่มีรายการกำลังทำ" },
  { status: "ready", label: "พร้อมเสิร์ฟ", empty: "ยังไม่มีรายการพร้อมเสิร์ฟ" }
];

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
  const [now, setNow] = useState(() => Date.now());
  const inFlightRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/pos/kitchen/queue?status=queued,acknowledged,preparing,ready&limit=100", { cache: "no-store" });
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

  return (
    <section className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-100 text-slate-900">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
        <div>
          <h1 className="text-xl font-black">ครัว · Kitchen Display</h1>
          <p className="mt-1 text-sm text-slate-500">ออเดอร์จากหน้าขายและ QR โต๊ะ · อัปเดตอัตโนมัติทุก 3 วินาที</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-blue-50 px-3 py-1.5 text-xs font-bold text-blue-700">งานค้าง {tickets.filter((ticket) => ticket.status !== "ready").length}</span>
          <button type="button" onClick={() => void load()} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold">รีเฟรช</button>
        </div>
      </header>

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
                          <div><strong className="text-lg">#{ticket.order_no}</strong><p className="text-xs font-semibold text-slate-500">{ticket.zone?.zone_name ?? "ครัว"}</p></div>
                          <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${isLate ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>{ageText(ticket.created_at, now)}</span>
                        </div>
                        <div className="mt-3 grid gap-2">
                          {ticket.items.map((item) => <div key={item.id} className="flex items-start justify-between gap-3 border-t border-slate-100 pt-2 first:border-0 first:pt-0"><div><span className="font-bold">{item.product_name}</span>{item.notes ? <small className="block text-xs text-orange-600">{item.notes}</small> : null}</div><strong className="text-lg">×{item.quantity}</strong></div>)}
                        </div>
                        {ticket.order_notes ? <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">หมายเหตุ: {ticket.order_notes}</p> : null}
                        {nextStatus(ticket.status) ? <button type="button" onClick={() => void transition(ticket)} disabled={Boolean(busyId)} className="mt-4 w-full rounded-xl bg-blue-600 px-3 py-2.5 text-sm font-black text-white disabled:opacity-50">{busyId === ticket.id ? "กำลังบันทึก..." : nextLabel(ticket.status)}</button> : <div className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-center text-sm font-black text-emerald-700">พร้อมเสิร์ฟแล้ว</div>}
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
