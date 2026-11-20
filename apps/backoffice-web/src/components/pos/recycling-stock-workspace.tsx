"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import type { RecyclingCatalogItem, RecyclingPriceBasis } from "@/lib/server/recycling-pos-service";

const money = (v: number | null) => v === null ? "ยังไม่กำหนด"
  : new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

type FormState = {
  id?: string;
  sku: string;
  name: string;
  category: string;
  price_basis: RecyclingPriceBasis;
  buy_price: string;
  sell_price: string;
  image_url: string;
};
const blank: FormState = {
  sku: "", name: "", category: "", price_basis: "kg",
  buy_price: "", sell_price: "", image_url: ""
};

export function RecyclingStockWorkspace({ items, branchName, canManage }: {
  items: RecyclingCatalogItem[];
  branchName: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const rows = useMemo(() => items.filter(item =>
    [item.name, item.sku, item.category].some(value => value.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()))
  ), [items, filter]);
  const incomplete = items.filter(item => item.buyPrice === null || item.sellPrice === null).length;

  function edit(item?: RecyclingCatalogItem) {
    setError("");
    setNotice("");
    setEditing(item ? {
      id: item.id, sku: item.sku, name: item.name, category: item.category,
      price_basis: item.priceBasis, buy_price: item.buyPrice === null ? "" : String(item.buyPrice),
      sell_price: item.sellPrice === null ? "" : String(item.sellPrice),
      image_url: item.imageUrl ?? ""
    } : { ...blank });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/pos/recycling/catalog", {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...editing,
          buy_price: Number(editing.buy_price),
          sell_price: Number(editing.sell_price)
        })
      });
      const payload = await response.json().catch(() => null) as {
        error?: { message?: string; code?: string } | null;
      } | null;
      if (!response.ok) {
        setError(payload?.error?.message ?? "บันทึกสินค้าไม่สำเร็จ โปรดลองใหม่");
        return;
      }
      setEditing(null);
      setNotice("บันทึกวัสดุและราคาเรียบร้อยแล้ว");
      router.refresh();
    } catch {
      setError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อบันทึกราคา");
    } finally {
      setBusy(false);
    }
  }

  return <main className="mx-auto max-w-[1500px] space-y-4 px-3 pb-8 pt-4 md:px-6" data-testid="recycling-custom-stock">
    <header className="rounded-xl border border-blue-200 bg-gradient-to-r from-blue-950 to-blue-800 p-5 text-white">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-bold tracking-widest text-blue-200">CUSTOM · RECYCLING STOCK</p>
          <h1 className="mt-1 text-2xl font-extrabold">ทะเบียนวัสดุและราคา</h1>
          <p className="mt-1 text-sm text-blue-100">{branchName} · แสดงราคาซื้อเข้าและราคาขายออกแยกกัน</p></div>
        <div className="flex flex-wrap gap-2">
          {canManage && <button type="button" onClick={() => edit()}
            className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-blue-800 hover:bg-blue-50">+ เพิ่มวัสดุ</button>}
          <Link className="rounded-lg border border-white/30 px-4 py-2 text-sm font-bold hover:bg-white/10"
            href="/preview/pos/recycling">กลับหน้ารับซื้อ / ขายออก</Link>
        </div>
      </div>
    </header>
    <div role="note" className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
      ราคาซื้อเข้าและราคาขายออกสามารถจัดการจากหน้านี้โดยเจ้าของร้านหรือผู้จัดการ
      ยอดคงเหลือและต้นทุนต้องอ้างอิงจากธุรกรรมที่ผ่านการบันทึกจริงเท่านั้น ห้ามถือว่าการตั้งราคาคือการเพิ่มสต๊อก
    </div>
    {notice && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{notice}</p>}
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
      <div className="overflow-x-auto"><table className="w-full min-w-[1000px] border-collapse text-sm">
        <thead className="bg-slate-100 text-left text-slate-700"><tr>
          <th className="px-4 py-3">ภาพ</th><th className="px-4 py-3">รหัสบาร์โค้ด</th>
          <th className="px-4 py-3">ชื่อวัสดุ</th><th className="px-4 py-3">ประเภท</th>
          <th className="px-4 py-3 text-right">ราคารับซื้อ (บาท)</th><th className="px-4 py-3 text-right">ราคาขายออก (บาท)</th>
          <th className="px-4 py-3">หน่วยราคา</th>{canManage && <th className="px-4 py-3">จัดการ</th>}
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
          {canManage && <td className="px-4 py-3"><button type="button" onClick={() => edit(item)}
            className="rounded-lg border border-blue-200 px-3 py-2 font-semibold text-blue-700 hover:bg-blue-50">แก้ไข</button></td>}
        </tr>) : <tr><td colSpan={canManage ? 8 : 7} className="px-4 py-16 text-center text-slate-500">
          ยังไม่มีวัสดุที่ตรงกับเงื่อนไขการค้นหา
        </td></tr>}</tbody>
      </table></div>
    </section>

    {editing && <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/70 p-3">
      <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="material-editor-title"
        className="max-h-[92vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div><p className="text-xs font-bold tracking-widest text-blue-700">CUSTOM RECYCLING</p>
          <h3 className="mt-1 text-xl font-extrabold text-slate-900" id="material-editor-title">
            {editing.id ? "แก้ไขทะเบียนวัสดุ" : "เพิ่มวัสดุใหม่"}
          </h3>
          <p className="mt-1 text-sm text-slate-500">ใช้รหัสสินค้าเดียวกันสำหรับรับซื้อและขายออก แต่กำหนดราคาแยกกัน</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ["sku", "รหัสบาร์โค้ด / SKU"],
            ["name", "ชื่อวัสดุ"],
            ["category", "ประเภทวัสดุ"],
            ["image_url", "ลิงก์รูปสินค้า (HTTPS)"],
            ["buy_price", "ราคารับซื้อ (บาท/หน่วยฐาน)"],
            ["sell_price", "ราคาขายออก (บาท/หน่วยฐาน)"]
          ] as const).map(([key, label]) => <label key={key} className="block text-sm font-semibold text-slate-700">
            {label}
            <input required={key !== "image_url"} type={key.endsWith("_price") ? "number" : "text"}
              min={key.endsWith("_price") ? "0" : undefined} step={key.endsWith("_price") ? "0.01" : undefined}
              value={editing[key]} onChange={e => setEditing(current => current ? { ...current, [key]: e.target.value } : null)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-blue-600 focus:outline-none" />
          </label>)}
          <label className="block text-sm font-semibold text-slate-700">
            หน่วยราคามาตรฐาน
            <select disabled={Boolean(editing.id)} value={editing.price_basis}
              onChange={e => setEditing(current => current ? { ...current, price_basis: e.target.value as RecyclingPriceBasis } : null)}
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2">
              <option value="kg">บาท / กิโลกรัม</option><option value="piece">บาท / ชิ้น</option>
            </select>
            {editing.id && <small className="block text-xs text-amber-700">หากต้องเปลี่ยนหน่วยราคา ต้องตรวจยอดคงเหลือก่อน</small>}
          </label>
        </div>
        {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} onClick={() => setEditing(null)}
            className="rounded-lg border border-slate-200 py-3 font-bold text-slate-700">ยกเลิก</button>
          <button type="submit" disabled={busy}
            className="rounded-lg bg-blue-700 py-3 font-bold text-white disabled:opacity-50">{busy ? "กำลังบันทึก..." : "บันทึกวัสดุ"}</button>
        </div>
      </form>
    </div>}
  </main>;
}
