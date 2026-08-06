"use client";

import { Check, MapPin, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export type TableZoneOption = {
  id: string;
  name: string;
  color: string | null;
  count: number;
};

export function TableZoneSelector({
  zones,
  selectedZoneId,
  totalCount,
}: {
  zones: TableZoneOption[];
  selectedZoneId: string;
  totalCount: number;
}) {
  const [open, setOpen] = useState(false);
  const selectedZone = zones.find((zone) => zone.id === selectedZoneId) ?? null;
  const selectedLabel = selectedZone?.name ?? "ทั้งหมด";
  const selectedCount = selectedZone?.count ?? totalCount;

  if (!zones.length) return null;

  return (
    <>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-10 min-w-0 items-center gap-2 rounded-[14px] border border-[#d4e5f8] bg-white px-3 text-[12px] font-black text-[#17416f] shadow-[0_5px_14px_rgba(15,39,69,0.05)] active:bg-[#f8fbff]"
        >
          <MapPin size={15} />
          <span className="min-w-0 truncate">โซน: {selectedLabel}</span>
          <span className="rounded-full bg-[#eef6ff] px-2 py-0.5 text-[10px] text-[#1677d9]">{selectedCount}</span>
        </button>
        <span className="shrink-0 text-[10px] font-bold text-[#7a8fa8]">{zones.length} โซน</span>
      </div>

      {open ? (
        <div role="dialog" aria-modal="true" aria-label="เลือกโซน" className="fixed inset-0 z-[180] flex items-end justify-center bg-[rgba(15,39,69,0.35)] px-4 pb-[max(18px,env(safe-area-inset-bottom))] pt-[max(20px,env(safe-area-inset-top))]">
          <section className="w-full max-w-[398px] overflow-hidden rounded-[20px] border border-[#d9e8f7] bg-white shadow-[0_18px_48px_rgba(15,39,69,0.22)]">
            <header className="flex items-center justify-between gap-3 border-b border-[#e6f0fb] px-4 py-3">
              <div className="min-w-0">
                <h2 className="m-0 text-[17px] font-black text-[#0f2745]">เลือกโซน</h2>
                <p className="m-0 mt-0.5 text-[11px] font-bold text-[#7a8fa8]">{zones.length} โซน / {totalCount} โต๊ะ</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="grid min-h-9 w-9 shrink-0 place-items-center rounded-full border border-[#d9e8f7] bg-white text-[#17416f]" aria-label="ปิด">
                <X size={18} />
              </button>
            </header>

            <div className="max-h-[58dvh] overflow-y-auto p-3">
              <div className="grid gap-2">
                <Link href="/sales/table" prefetch={false} onClick={() => setOpen(false)} className={`grid min-h-12 grid-cols-[1fr_auto_auto] items-center gap-2 rounded-[14px] border px-3 text-[13px] font-black no-underline ${selectedZoneId === "all" ? "border-[#1677d9] bg-[#eef6ff] text-[#0f2745]" : "border-[#d9e8f7] bg-[#f8fbff] text-[#17416f]"}`}>
                  <span>ทั้งหมด</span>
                  <span className="rounded-full bg-white px-2 py-1 text-[11px] text-[#1677d9]">{totalCount}</span>
                  {selectedZoneId === "all" ? <Check size={16} className="text-[#1677d9]" /> : <span className="w-4" />}
                </Link>
                {zones.map((zone) => {
                  const active = selectedZoneId === zone.id;
                  return (
                    <Link key={zone.id} href={`/sales/table?zone=${encodeURIComponent(zone.id)}`} prefetch={false} onClick={() => setOpen(false)} className={`grid min-h-12 grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded-[14px] border px-3 text-[13px] font-black no-underline ${active ? "border-[#1677d9] bg-[#eef6ff] text-[#0f2745]" : "border-[#d9e8f7] bg-[#f8fbff] text-[#17416f]"}`}>
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: zone.color || "#1677d9" }} aria-hidden="true" />
                      <span className="min-w-0 truncate">{zone.name}</span>
                      <span className="rounded-full bg-white px-2 py-1 text-[11px] text-[#1677d9]">{zone.count}</span>
                      {active ? <Check size={16} className="text-[#1677d9]" /> : <span className="w-4" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
