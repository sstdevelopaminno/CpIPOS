"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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

export function RecyclingStockWorkspace({ items, branchName, canManage, canViewAccounting }: {
  items: RecyclingCatalogItem[];
  branchName: string;
  canManage: boolean;
  canViewAccounting: boolean;
}) {
  const router = useRouter();
  const addButtonRef = useRef<HTMLButtonElement>(null);
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

  function closeEditor() {
    if (busy) return;
    setEditing(null);
    window.requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        setEditing(null);
        window.requestAnimationFrame(() => addButtonRef.current?.focus());
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editing, busy]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    if (!editing.buy_price.trim() || !editing.sell_price.trim()) {
      setError("กรุณาระบุราคารับซื้อและราคาขายออกก่อนบันทึก");
      return;
    }
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

  return <main className="recycling-stock-layout flex h-full min-h-0 w-full flex-col overflow-hidden bg-white" data-testid="recycling-custom-stock">
    <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-3" data-testid="recycling-stock-toolbar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-blue-700">CpiPOS / CUSTOM Recycling / จัดการสินค้า</p>
          <h1 className="mt-1 text-xl font-extrabold text-slate-950">จัดการสินค้าและวัสดุรีไซเคิล</h1>
          <p className="mt-0.5 text-xs text-slate-500">สาขา: {branchName} · ทะเบียนวัสดุเดียวสำหรับรับซื้อและขายออก</p>
        </div>
        <nav className="flex flex-wrap items-center gap-2" aria-label="ทางลัดหน้าจัดการวัสดุ">
          <Link href="/preview/pos/more" className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            ← กลับเมนูเพิ่มเติม
          </Link>
          <Link href="/preview/pos/recycling" className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            กลับหน้ารับซื้อ / ขายออก
          </Link>
          {canViewAccounting && <Link href="/preview/pos/recycling/accounting"
            className="inline-flex min-h-10 items-center rounded-lg border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-900 hover:bg-blue-100">
            สมุดบัญชีย่อย
          </Link>}
          {canManage && <button ref={addButtonRef} type="button" onClick={() => edit()}
            className="inline-flex min-h-10 items-center rounded-lg bg-blue-700 px-4 text-sm font-extrabold text-white hover:bg-blue-800">
            + เพิ่มวัสดุ
          </button>}
        </nav>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-slate-100 pt-3 text-xs" data-testid="recycling-stock-inline-summary">
        <span className="text-slate-600">วัสดุทั้งหมด <strong className="ml-1 text-base tabular-nums text-slate-950">{items.length}</strong></span>
        <span className="text-slate-600">กำหนดราคาครบ <strong className="ml-1 text-base tabular-nums text-emerald-700">{items.length - incomplete}</strong></span>
        <span className="text-slate-600">รอตั้งราคา <strong className="ml-1 text-base tabular-nums text-amber-700">{incomplete}</strong></span>
        <span className="text-slate-500">ราคาซื้อเข้าและราคาขายออกแยกกัน · สต๊อกเปลี่ยนจากธุรกรรมที่บันทึกจริงเท่านั้น</span>
      </div>
    </header>

    {notice && <p role="status" className="mx-3 mt-2 shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800">{notice}</p>}

    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="ทะเบียนวัสดุ" data-testid="recycling-stock-table-area">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/60 px-4 py-3">
        <div>
          <h2 className="text-sm font-extrabold text-slate-900">รายการวัสดุในสาขา</h2>
          <p className="mt-1 text-xs text-slate-500">รูปภาพ · บาร์โค้ด · วัสดุ · ราคารับซื้อ / ขายออก · คงเหลือ</p>
        </div>
        <label className="w-full max-w-xs text-xs font-semibold text-slate-700">
          ค้นหาวัสดุ
          <input value={filter} onChange={event => setFilter(event.target.value)}
            placeholder="ชื่อวัสดุ / บาร์โค้ด / ประเภท"
            className="mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"/>
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto" data-testid="recycling-stock-table-scroll">
        <table className="w-full min-w-[1050px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-slate-100 text-left text-slate-700"><tr>
            <th scope="col" className="px-3 py-3">ภาพ</th>
            <th scope="col" className="px-3 py-3">รหัสบาร์โค้ด</th>
            <th scope="col" className="px-3 py-3">ชื่อวัสดุ</th>
            <th scope="col" className="px-3 py-3">ประเภท</th>
            <th scope="col" className="px-3 py-3 text-right">ราคารับซื้อ (บาท)</th>
            <th scope="col" className="px-3 py-3 text-right">ราคาขายออก (บาท)</th>
            <th scope="col" className="px-3 py-3">หน่วยราคา</th>
            <th scope="col" className="px-3 py-3 text-right">คงเหลือ</th>
            {canManage && <th scope="col" className="px-3 py-3 text-center">จัดการ</th>}
          </tr></thead>
          <tbody>
            {rows.length ? rows.map(item => <tr key={item.id} className="border-t border-slate-100 hover:bg-blue-50/40">
              <td className="px-3 py-2">{item.imageUrl
                ? <Image src={item.imageUrl} alt={item.name} width={48} height={48} unoptimized className="h-11 w-11 rounded-lg object-cover"/>
                : <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-xl" aria-label="ยังไม่มีภาพวัสดุ">♻️</span>}</td>
              <td className="px-3 py-2 font-mono text-slate-700">{item.sku || "ยังไม่ระบุ"}</td>
              <td className="px-3 py-2 font-bold text-slate-900">{item.name}</td>
              <td className="px-3 py-2 text-slate-600">{item.category}</td>
              <td className="px-3 py-2 text-right font-bold tabular-nums text-blue-700">{money(item.buyPrice)}</td>
              <td className="px-3 py-2 text-right font-bold tabular-nums text-emerald-700">{money(item.sellPrice)}</td>
              <td className="px-3 py-2 text-slate-600">{item.priceBasis === "kg" ? "บาท/กก." : "บาท/ชิ้น"}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-800">
                {item.quantityBase === null ? "รอยืนยันสต๊อก" : item.quantityBase.toLocaleString("th-TH", {maximumFractionDigits:6}) + (item.priceBasis === "kg" ? " กก." : " ชิ้น")}
              </td>
              {canManage && <td className="px-3 py-2 text-center">
                <button type="button" onClick={() => edit(item)}
                  className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-50">
                  แก้ไข
                </button>
              </td>}
            </tr>) : <tr><td colSpan={canManage ? 9 : 8} className="px-4 py-16 text-center">
              <p className="text-sm font-semibold text-slate-700">{items.length === 0 ? "ยังไม่มีวัสดุในสาขานี้" : "ไม่พบวัสดุตรงกับคำค้นหา"}</p>
              <p className="mt-1 text-xs text-slate-500">{items.length === 0 ? "เพิ่มวัสดุเพื่อใช้ในหน้ารับซื้อและขายออก" : "ลองค้นหาด้วยชื่อ ประเภท หรือบาร์โค้ดอื่น"}</p>
              {canManage && items.length === 0 && <button type="button" onClick={() => edit()}
                className="mt-4 rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white hover:bg-blue-800">+ เพิ่มวัสดุรายการแรก</button>}
            </td></tr>}
          </tbody>
        </table>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-2 text-xs text-slate-500">
        <span>แสดง {rows.length} จาก {items.length} รายการ · {branchName}</span>
        <span>{canManage ? "สิทธิ์แก้ไข: เจ้าของร้าน / ผู้จัดการ" : "โหมดอ่านอย่างเดียว · เจ้าของร้านหรือผู้จัดการเป็นผู้แก้ไขข้อมูล"}</span>
      </footer>
    </section>

    {editing && <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/70 p-3"
      role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeEditor(); }}>
      <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="material-editor-title" aria-describedby="material-editor-description"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        data-testid="recycling-material-editor">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-700">CUSTOM Recycling · จัดการสินค้า</p>
            <h3 id="material-editor-title" className="mt-1 text-xl font-extrabold text-slate-950">{editing.id ? "แก้ไขข้อมูลวัสดุ" : "เพิ่มวัสดุใหม่"}</h3>
            <p id="material-editor-description" className="mt-1 text-xs text-slate-600">บาร์โค้ดเดียวกันใช้ได้ทั้งรับซื้อและขายออก โดยแยกราคาแต่ละประเภท</p>
          </div>
          <button type="button" disabled={busy} onClick={closeEditor} aria-label="ปิดหน้าต่างเพิ่มวัสดุ"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50">×</button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <fieldset className="space-y-3">
            <legend className="text-sm font-extrabold text-slate-900">ข้อมูลวัสดุ</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-slate-700">รหัสบาร์โค้ด / SKU
                <input autoFocus required maxLength={90} value={editing.sku} onChange={event => setEditing(current => current ? {...current, sku:event.target.value} : null)}
                  placeholder="ยิงบาร์โค้ดหรือกรอกรหัส" className="mt-1 block h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"/>
              </label>
              <label className="block text-xs font-semibold text-slate-700">ชื่อวัสดุ
                <input required maxLength={200} value={editing.name} onChange={event => setEditing(current => current ? {...current, name:event.target.value} : null)}
                  placeholder="เช่น เหล็ก / กระดาษ / พลาสติก" className="mt-1 block h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"/>
              </label>
              <label className="block text-xs font-semibold text-slate-700">ประเภทวัสดุ
                <input required maxLength={120} value={editing.category} onChange={event => setEditing(current => current ? {...current, category:event.target.value} : null)}
                  placeholder="กลุ่มวัสดุ" className="mt-1 block h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"/>
              </label>
              <label className="block text-xs font-semibold text-slate-700">หน่วยราคามาตรฐาน
                <select disabled={Boolean(editing.id)} value={editing.price_basis}
                  onChange={event => setEditing(current => current ? {...current, price_basis:event.target.value as RecyclingPriceBasis} : null)}
                  className="mt-1 block h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none disabled:bg-slate-100 disabled:text-slate-500">
                  <option value="kg">กิโลกรัม (บาท/กก.)</option><option value="piece">ชิ้น (บาท/ชิ้น)</option>
                </select>
              </label>
            </div>
            {editing.id && <p className="text-xs font-medium text-amber-800">หน่วยราคาของวัสดุที่บันทึกแล้วเปลี่ยนไม่ได้จนกว่าจะตรวจและแปลงสต๊อกอย่างถูกต้อง</p>}
          </fieldset>

          <fieldset className="space-y-3 border-t border-slate-200 pt-4">
            <legend className="text-sm font-extrabold text-slate-900">กำหนดราคาแยกตามธุรกรรม</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-sm font-bold text-blue-900">
                ราคารับซื้อเข้าร้าน (บาท/หน่วยฐาน)
                <input required min="0" max="99999999" step="0.01" type="number" inputMode="decimal" value={editing.buy_price}
                  onChange={event => setEditing(current => current ? {...current, buy_price:event.target.value} : null)}
                  placeholder="0.00" className="mt-2 block h-11 w-full rounded-lg border border-blue-200 bg-white px-3 text-base tabular-nums text-slate-900 outline-none focus:border-blue-600"/>
                <small className="mt-2 block text-xs font-normal text-blue-800">ใช้ตอนร้านจ่ายเงินรับซื้อวัสดุ</small>
              </label>
              <label className="block rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm font-bold text-emerald-900">
                ราคาขายออก (บาท/หน่วยฐาน)
                <input required min="0" max="99999999" step="0.01" type="number" inputMode="decimal" value={editing.sell_price}
                  onChange={event => setEditing(current => current ? {...current, sell_price:event.target.value} : null)}
                  placeholder="0.00" className="mt-2 block h-11 w-full rounded-lg border border-emerald-200 bg-white px-3 text-base tabular-nums text-slate-900 outline-none focus:border-emerald-600"/>
                <small className="mt-2 block text-xs font-normal text-emerald-800">ใช้ตอนร้านรับเงินจากการขายวัสดุ</small>
              </label>
            </div>
          </fieldset>

          <fieldset className="space-y-2 border-t border-slate-200 pt-4">
            <legend className="text-sm font-extrabold text-slate-900">รูปภาพวัสดุ (ไม่บังคับ)</legend>
            <div className="flex items-center gap-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-2xl">
                {editing.image_url.trim().startsWith("https://")
                  ? <Image src={editing.image_url.trim()} alt="ตัวอย่างรูปวัสดุ" width={64} height={64} unoptimized className="h-full w-full object-cover"/>
                  : <span aria-hidden="true">♻️</span>}
              </div>
              <label className="min-w-0 flex-1 text-xs font-semibold text-slate-700">ลิงก์รูปภาพ HTTPS
                <input type="url" maxLength={1000} value={editing.image_url} onChange={event => setEditing(current => current ? {...current,image_url:event.target.value} : null)}
                  placeholder="https://..." className="mt-1 block h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-600"/>
              </label>
            </div>
          </fieldset>
          {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3">
          <p className="max-w-xs text-xs text-slate-500">การเพิ่มวัสดุไม่ใช่การเพิ่มยอดสต๊อก ยอดคงเหลือเปลี่ยนจากธุรกรรมที่บันทึกจริง</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={closeEditor}
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">← กลับ</button>
            <button type="submit" disabled={busy}
              className="min-h-11 rounded-lg bg-blue-700 px-5 text-sm font-extrabold text-white hover:bg-blue-800 disabled:opacity-50">
              {busy ? "กำลังบันทึก..." : editing.id ? "บันทึกการแก้ไข" : "เพิ่มวัสดุ"}
            </button>
          </div>
        </div>
      </form>
    </div>}
  </main>;
}
