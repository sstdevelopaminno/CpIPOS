"use client";

import { Armchair, ChevronLeft, ChevronRight, Clock3, Hash, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export type TableGridItem = {
  id: string;
  tableCode: string | null;
  tableName: string | null;
  capacity: number | null;
  effectiveStatus: string | null;
  openedAt: string | null;
};

const PAGE_SIZE = 10;

function statusLabel(status: string | null | undefined) {
  if (status === "available") return "ว่าง";
  if (status === "occupied" || status === "open") return "เปิดบิล";
  if (status === "ordering") return "มีรายการ";
  if (status === "pending_payment") return "รอชำระ";
  if (status === "reserved") return "จอง";
  if (status === "disabled") return "ปิดใช้";
  return status ?? "-";
}

function tableTone(status: string | null | undefined) {
  if (status === "available") return "border-[#cfe2f5] bg-white text-[#0f2745]";
  if (status === "occupied" || status === "open") return "border-[#ffd6a7] bg-[#fff8ed] text-[#9a5b00]";
  if (status === "ordering") return "border-[#b9dcff] bg-[#f0f7ff] text-[#1677d9]";
  if (status === "pending_payment") return "border-[#bdebd0] bg-[#effdf5] text-[#0f8d46]";
  return "border-[#e4e7ec] bg-[#f8fafc] text-[#667085]";
}

function badgeTone(status: string | null | undefined) {
  if (status === "available") return "bg-[#e8fff2] text-[#0f8d46]";
  if (status === "pending_payment") return "bg-[#e8fff2] text-[#0f8d46]";
  if (status === "ordering") return "bg-[#eef6ff] text-[#1677d9]";
  if (status === "occupied" || status === "open") return "bg-[#fff4df] text-[#b65f00]";
  return "bg-[#eef2f7] text-[#64748b]";
}

function timeLabel(value: string | null | undefined) {
  if (!value) return null;
  return new Date(value).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
}

export function TableGridPager({ tables }: { tables: TableGridItem[] }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(tables.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const isPaged = tables.length > PAGE_SIZE;
  const visibleTables = useMemo(() => tables.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [safePage, tables]);

  useEffect(() => {
    setPage(1);
  }, [tables]);

  return (
    <section className="grid min-w-0 gap-2.5">
      {isPaged ? (
        <div className="flex items-center justify-between gap-2 text-[11px] font-black text-[#587398]">
          <span>โต๊ะ {((safePage - 1) * PAGE_SIZE) + 1}-{Math.min(safePage * PAGE_SIZE, tables.length)} / {tables.length}</span>
          <span>หน้า {safePage} / {totalPages}</span>
        </div>
      ) : null}

      <div className={`grid grid-cols-2 gap-2.5 ${isPaged ? "max-h-[min(54dvh,430px)] overflow-y-auto pr-1" : ""}`}>
        {visibleTables.length ? (
          visibleTables.map((table) => {
            const name = table.tableName || table.tableCode || "โต๊ะ";
            const openedAt = timeLabel(table.openedAt);
            return (
              <Link key={table.id} href={`/sales/table/${table.id}`} prefetch={false} className={`block min-w-0 rounded-[16px] border p-3 no-underline shadow-[0_5px_14px_rgba(15,39,69,0.05)] active:scale-[0.99] ${tableTone(table.effectiveStatus)}`}>
                <article className="grid min-h-[102px] grid-rows-[auto_1fr_auto]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex min-w-0 items-center gap-1 text-[11px] font-black opacity-75">
                      <Armchair size={13} />
                      โต๊ะ
                    </span>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-black leading-none ${badgeTone(table.effectiveStatus)}`}>
                      {statusLabel(table.effectiveStatus)}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <h2 className="m-0 mt-1 truncate text-[19px] font-black leading-tight">{name}</h2>
                    <p className="m-0 mt-1 inline-flex max-w-full items-center gap-1 truncate text-[10px] font-black opacity-70">
                      <Hash size={11} />
                      เลขโต๊ะ {table.tableCode || "-"}
                    </p>
                  </div>
                  <div className="mt-2 flex min-w-0 items-center justify-between gap-2 text-[11px] font-bold opacity-85">
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <Users size={12} />
                      {table.capacity ?? 0} คน
                    </span>
                    {openedAt ? (
                      <span className="inline-flex min-w-0 items-center gap-1 truncate">
                        <Clock3 size={12} />
                        {openedAt}
                      </span>
                    ) : null}
                  </div>
                </article>
              </Link>
            );
          })
        ) : (
          <div className="col-span-2 rounded-[18px] border border-[#d4e5f8] bg-white p-5 text-[15px] font-bold text-[#587398] shadow-[0_5px_14px_rgba(15,39,69,0.05)]">ยังไม่มีผังโต๊ะในสาขานี้</div>
        )}
      </div>

      {isPaged ? (
        <nav className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 pt-1" aria-label="แบ่งหน้าโต๊ะ">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={safePage <= 1}
            className="inline-flex min-h-11 items-center justify-center gap-1 rounded-[14px] border border-[#d4e5f8] bg-white px-3 text-[12px] font-black text-[#17416f] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ChevronLeft size={16} />
            ก่อนหน้า
          </button>
          <span className="text-center text-[13px] font-black text-[#17416f]">{safePage} / {totalPages}</span>
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
