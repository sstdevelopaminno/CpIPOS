"use client";

import { Banknote, ChevronLeft, ChevronRight, ClipboardList, ReceiptText, Search, X } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

export type MobileOrderListItem = {
  id: string;
  orderNo: string;
  orderType: string | null;
  status: string | null;
  total: number;
  createdAt: string | null;
};

const FILTERS = [
  { key: "all", label: "ทั้งหมด" },
  { key: "completed", label: "ชำระแล้ว" },
  { key: "draft", label: "กำลังขาย" },
  { key: "cancelled", label: "ยกเลิก" },
] as const;

const PAGE_SIZE = 12;

type FilterKey = (typeof FILTERS)[number]["key"];

function money(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortMoney(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function statusLabel(status: string | null | undefined) {
  if (status === "paid" || status === "completed") return "ชำระแล้ว";
  if (status === "draft") return "กำลังขาย";
  if (status === "held") return "พักบิล";
  if (status === "cancelled") return "ยกเลิก";
  return status ?? "-";
}

function statusTone(status: string | null | undefined) {
  if (status === "paid" || status === "completed") return "bg-[#e8fff2] text-[#0f8d46]";
  if (status === "draft") return "bg-[#eef6ff] text-[#1677d9]";
  if (status === "cancelled") return "bg-[#fff1f1] text-[#d62929]";
  return "bg-[#eef2f7] text-[#64748b]";
}

function orderTypeLabel(type: string | null | undefined) {
  if (type === "takeaway") return "กลับบ้าน";
  if (type === "dine_in") return "โต๊ะ";
  if (type === "delivery" || type === "delivery_manual") return "เดลิเวอรี่";
  return type ?? "order";
}

function matchesFilter(order: MobileOrderListItem, filter: FilterKey) {
  if (filter === "all") return true;
  if (filter === "completed") return order.status === "completed" || order.status === "paid";
  return order.status === filter;
}

export function OrdersListClient({ orders }: { orders: MobileOrderListItem[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(query);

  const paidTotal = useMemo(() => orders.filter((order) => order.status === "completed" || order.status === "paid").reduce((sum, order) => sum + order.total, 0), [orders]);
  const filteredOrders = useMemo(() => {
    const search = deferredQuery.trim().toLowerCase();
    return orders.filter((order) => {
      if (!matchesFilter(order, filter)) return false;
      if (!search) return true;
      const haystack = [
        order.orderNo,
        orderTypeLabel(order.orderType),
        statusLabel(order.status),
        money(order.total),
        formatDate(order.createdAt),
      ].join(" ").toLowerCase();
      return haystack.includes(search);
    });
  }, [deferredQuery, filter, orders]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleOrders = filteredOrders.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  useEffect(() => {
    setPage(1);
  }, [deferredQuery, filter]);

  return (
    <section className="grid w-full max-w-full min-w-0 gap-3 pb-8">
      <div className="grid min-w-0 grid-cols-2 gap-3">
        <section className="min-w-0 rounded-[16px] border border-[#d4e5f8] bg-white p-3 shadow-[0_6px_14px_rgba(15,39,69,0.05)]">
          <div className="mb-2 flex items-start justify-between gap-2">
            <span className="min-w-0 text-[11px] font-black leading-tight text-[#587398]">รายการในกะ</span>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[13px] bg-[#f0f6ff] text-[#1677d9]">
              <ClipboardList size={19} />
            </span>
          </div>
          <b className="block truncate text-[20px] leading-none text-[#031f3d]">{orders.length}</b>
        </section>
        <section className="min-w-0 rounded-[16px] border border-[#d4e5f8] bg-white p-3 shadow-[0_6px_14px_rgba(15,39,69,0.05)]">
          <div className="mb-2 flex items-start justify-between gap-2">
            <span className="min-w-0 text-[11px] font-black leading-tight text-[#587398]">ยอดชำระแล้ว</span>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[13px] bg-[#e8fff2] text-[#0f8d46]">
              <Banknote size={19} />
            </span>
          </div>
          <b className="block truncate text-[20px] leading-none text-[#031f3d]">{money(paidTotal)} ฿</b>
        </section>
      </div>

      <section className="sticky top-0 z-30 -mx-1 min-w-0 overflow-hidden rounded-[18px] border border-[#d4e5f8] bg-white/95 p-3 shadow-[0_8px_18px_rgba(15,39,69,0.08)] backdrop-blur">
        <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="m-0 text-[17px] font-black text-[#0f2745]">ค้นหาบิล</h2>
            <p className="m-0 mt-1 text-[11px] font-bold text-[#7a8fa8]">{filteredOrders.length} / {orders.length} รายการ</p>
          </div>
          {query ? (
            <button type="button" onClick={() => setQuery("")} className="grid min-h-10 w-10 shrink-0 place-items-center rounded-[13px] border border-[#d9e8f7] bg-white text-[#17416f]" aria-label="ล้างคำค้น">
              <X size={18} />
            </button>
          ) : null}
        </div>

        <label className="mb-3 grid h-11 grid-cols-[auto_1fr] items-center gap-2 rounded-[14px] border border-[#cfe1f5] bg-[#fbfdff] px-3 focus-within:border-[#1677d9] focus-within:ring-2 focus-within:ring-[#b9dcff]">
          <Search size={18} className="text-[#5f7491]" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ค้นหาเลขบิล / สถานะ / ยอดเงิน"
            className="min-w-0 bg-transparent text-[14px] font-bold text-[#0f2745] outline-none placeholder:text-[#9aaac0]"
            aria-label="ค้นหาบิล"
          />
        </label>

        <div className="-mx-1 flex max-w-full touch-pan-x gap-2 overflow-x-auto px-1 pb-1">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={`min-h-10 shrink-0 rounded-full border px-4 text-[12px] font-black outline-none focus-visible:ring-2 focus-visible:ring-[#1677d9] focus-visible:ring-offset-2 ${filter === item.key ? "border-[#1677d9] bg-[#1677d9] text-white" : "border-[#d9e8f7] bg-[#f8fbff] text-[#17416f]"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-[18px] border border-[#d4e5f8] bg-white shadow-[0_6px_14px_rgba(15,39,69,0.05)]">
        <div className="grid grid-cols-[minmax(0,1fr)_76px_72px] items-center gap-2 border-b border-[#e3edf8] bg-[#f8fbff] px-3 py-2 text-[11px] font-black text-[#587398]">
          <span>บิล</span>
          <span className="text-center">สถานะ</span>
          <span className="text-right">ยอด</span>
        </div>

        {visibleOrders.length ? (
          <div className="divide-y divide-[#edf3fb]">
            {visibleOrders.map((order) => (
              <Link key={order.id} href={`/orders/${order.id}`} prefetch={false} className="grid min-h-[72px] grid-cols-[minmax(0,1fr)_76px_72px] items-center gap-2 bg-white px-3 py-2 text-[#0f2745] no-underline active:bg-[#f3f8ff]">
                <div className="min-w-0">
                  <p className="m-0 text-[11px] font-black leading-tight text-[#7a8fa8]">{orderTypeLabel(order.orderType)}</p>
                  <h2 className="m-0 mt-0.5 truncate text-[15px] font-black leading-tight text-[#0f2745]">{order.orderNo}</h2>
                  <p className="m-0 mt-1 truncate text-[11px] font-bold text-[#7a8fa8]">{formatDate(order.createdAt)}</p>
                </div>
                <span className={`justify-self-center rounded-full px-2 py-1 text-[10px] font-black leading-none ${statusTone(order.status)}`}>{statusLabel(order.status)}</span>
                <div className="min-w-0 text-right">
                  <b className="block truncate text-[14px] leading-tight text-[#1677d9]">{shortMoney(order.total)} ฿</b>
                  <span className="mt-1 inline-flex items-center justify-end gap-1 text-[10px] font-black text-[#1677d9]">
                    <ReceiptText size={12} />
                    ดูบิล
                  </span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="p-4 text-[14px] font-bold text-[#587398]">ไม่พบบิลที่ตรงกับคำค้นหา</div>
        )}
      </section>

      {filteredOrders.length > PAGE_SIZE ? (
        <nav className="grid grid-cols-[1fr_auto_1fr] items-center gap-3" aria-label="แบ่งหน้ารายการขาย">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={safePage <= 1}
            className="inline-flex min-h-11 items-center justify-center gap-1 rounded-[14px] border border-[#d4e5f8] bg-white px-3 text-[12px] font-black text-[#17416f] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ChevronLeft size={16} />
            ก่อนหน้า
          </button>
          <span className="text-center text-[13px] font-black text-[#17416f]">หน้า {safePage} / {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={safePage >= totalPages}
            className="inline-flex min-h-11 items-center justify-center gap-1 rounded-[14px] border border-[#1677d9] bg-[#1677d9] px-3 text-[12px] font-black text-white disabled:border-[#d4e5f8] disabled:bg-white disabled:text-[#7a8fa8]"
          >
            ถัดไป
            <ChevronRight size={16} />
          </button>
        </nav>
      ) : null}
    </section>
  );
}
