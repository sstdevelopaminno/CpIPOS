"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { RecyclingCatalogItem } from "@/lib/server/recycling-pos-service";

const money = (v: number | null) => v === null ? "ยังไม่กำหนด"
  : new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

export function RecyclingStockWorkspace({ items, branchName }: { items: RecyclingCatalogItem[]; branchName: string }) {
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => items.filter(item =>
    [item.name, item.sku, item.category].some(value => value.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()))
  ), [items, filter]);
  const incomplete = items.filter(item => item.buyPrice === null || item.sellPrice === null).length;

  return <main className="mx-auto max-w-[1500px] space-y-4 px-3 pb-8 pt-4 md:px-6" data-testid="recycling-custom-stock">
    <header className="rounded-xl border border-blue-200 bg-gradient-to-r from-blue-950 to-blue-800 p-5 text-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-bold tracking-widest text-blue-200">CUSTOM · RECYCLING STOCK</p>
          <h1 className="mt-1 text-2xl font-extrabold">ทะเบียนวัสดุและราคา</h1>
          <p className="mt-1 text-sm text-blue-100">{branchName} · แสดงราคาซื้อเข้าและราคาขายออกแยกกัน</p></div>
        <Link className="rounded-lg border border-white/30 px-4 py-2 text-sm font-bold hover:bg-white/10"
          href="/preview/pos/recycling">กลับหน้ารับซื้อ / ขายออก</Link>
      </div>
    </header>
    <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
      นี่คือหน้าทะเบียนวัสดุรุ่นเริ่มต้นสำหรับตรวจ UI และราคาจากสินค้าเดิม ยังไม่เปิดการแก้ไขราคา รับสินค้า หรือตัดยอดสต๊อก
      จนกว่าระบบธุรกรรมและสิทธิ์อนุมัติจะผ่านการทดสอบ
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">วัสดุทั้งหมด</p><strong className="text-2xl text-slate-900">{items.length}</strong></div>
      <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">กำหนดราคาครบ</p><strong className="text-2xl text-emerald-700">{items.length-incomplete}</strong></div>
      <div className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">ต้องตั้งราคาเพิ่ม</p><strong className="text-2xl text-amber-700">{incomplete}</strong></div>
    </div>
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
        <div><h2 className="font-extrabold text-slate-900">ตารางสต๊อกวัสดุ</h2><p className="text-xs text-slate-500">ภาพสินค้า · รหัส · ชื่อ · ประเภท · ราคารับซื้อ · ราคาขายออก</p></div>
        <label className="w-full max-w-xs text-sm font-semibold text-slate-700">
          ค้นหาวัสดุ
          <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="ชื่อ / บาร์โค้ด / ประเภท"
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600" />
        </label>
      </div>
      <div className="overflow-x-auto"><table className="w-full min-w-[940px] border-collapse text-sm">
        <thead className="bg-slate-100 text-left text-slate-700"><tr>
          <th className="px-4 py-3">ภาพ</th><th className="px-4 py-3">รหัสบาร์โค้ด</th>
          <th className="px-4 py-3">ชื่อวัสดุ</th><th className="px-4 py-3">ประเภท</th>
          <th className="px-4 py-3 text-right">ราคารับซื้อ (บาท)</th><th className="px-4 py-3 text-right">ราคาขายออก (บาท)</th>
          <th className="px-4 py-3">หน่วยราคา</th>
        </tr></thead>
        <tbody>{rows.length ? rows.map(item => <tr key={item.id} className="border-t border-slate-100">
          <td className="px-4 py-2">{item.imageUrl
            ? <Image src={item.imageUrl} alt={item.name} width={50} height={50} unoptimized className="h-12 w-12 rounded-lg object-cover"/>
            : <span className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-xl" aria-label="ยังไม่มีภาพวัสดุ">♻️</span>}</td>
          <td className="px-4 py-3 font-mono text-slate-700">{item.sku || "ยังไม่ระบุ"}</td>
          <td className="px-4 py-3 font-bold text-slate-900">{item.name}</td>
          <td className="px-4 py-3 text-slate-600">{item.category}</td>
          <td className="px-4 py-3 text-right font-bold text-blue-700">{money(item.buyPrice)}</td>
          <td className="px-4 py-3 text-right font-bold text-emerald-700">{money(item.sellPrice)}</td>
          <td className="px-4 py-3 text-slate-600">{item.priceBasis === "kg" ? "บาท/กิโลกรัม" : "บาท/ชิ้น"}</td>
        </tr>) : <tr><td colSpan={7} className="px-4 py-16 text-center text-slate-500">
          ยังไม่มีวัสดุที่ตรงกับเงื่อนไขการค้นหา
        </td></tr>}</tbody>
      </table></div>
    </section>
  </main>;
}
