"use client";

import Image from "next/image";
import Link from "next/link";
import { RecyclingBarcodeDialog, RecyclingBarcodeMark } from "@/components/pos/recycling-barcode-dialog";
import { optimizeRecyclingMaterialImage } from "@/lib/recycling-material-image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { RecyclingCatalogItem, RecyclingPriceBasis } from "@/lib/server/recycling-pos-service";
import { type RecyclingPriceUnit, formatRecyclingUnitPrice, getRecyclingPriceBasis, parseRecyclingUnitPrice, RECYCLING_PRICE_UNIT_LABELS } from "@/lib/recycling-price-units";
import type { RecyclingStockBranch } from "@/lib/server/recycling-stock-branch-scope";

const money = (v: number | null) => v === null ? "ยังไม่กำหนด"
  : new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);

function isValidHttpsImagePreview(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" && Boolean(parsed.hostname) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

type FormState = {
  id?: string;
  sku: string;
  name: string;
  category: string;
  price_basis: RecyclingPriceBasis;
  price_unit: RecyclingPriceUnit;
  buy_price: string;
  sell_price: string;
  image_url: string;
};
const blank: FormState = {
  sku: "", name: "", category: "", price_basis: "kg", price_unit: "kg",
  buy_price: "", sell_price: "", image_url: ""
};

export function RecyclingStockWorkspace({ items, branches, branchId, branchName, canManage, mediaByProduct = {} }: {
  items: RecyclingCatalogItem[];
  branches: RecyclingStockBranch[];
  branchId: string;
  branchName: string;
  canManage: boolean;
  mediaByProduct?: Record<string,string>;
}) {
  const router = useRouter();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [filter, setFilter] = useState("");
  const [barcodeItem, setBarcodeItem] = useState<RecyclingCatalogItem | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const photoPreview = useMemo(() => photoFile ? URL.createObjectURL(photoFile) : "", [photoFile]);
  useEffect(() => () => { if(photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);
  const [editing, setEditing] = useState<FormState | null>(null);
  const [editingBranchId, setEditingBranchId] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteTarget,setDeleteTarget] = useState<RecyclingCatalogItem|"all"|null>(null);
  const [deleteConfirmation,setDeleteConfirmation] = useState("");
  const [deleteError,setDeleteError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const rows = useMemo(() => items.filter(item =>
    [item.name, item.sku, item.category].some(value => value.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()))
  ), [items, filter]);
  const incomplete = items.filter(item => item.buyPrice === null || item.sellPrice === null).length;

  function edit(item?: RecyclingCatalogItem) {
    // New materials require an explicit branch choice in the dialog, even
    // when the visible listing has a default branch.
    setPhotoFile(null);
    setEditingBranchId(item ? branchId : "");
    setError("");
    setNotice("");
    setEditing(item ? {
      id: item.id, sku: item.sku, name: item.name, category: item.category,
      price_basis: item.priceBasis, price_unit: item.priceUnit,
      buy_price: formatRecyclingUnitPrice(item.buyPrice, item.priceUnit),
      sell_price: formatRecyclingUnitPrice(item.sellPrice, item.priceUnit),
      image_url: item.imageUrl ?? ""
    } : { ...blank });
  }

  function selectPriceUnit(nextUnit: RecyclingPriceUnit) {
    setEditing(current => {
      if (!current || (current.id && getRecyclingPriceBasis(nextUnit) !== current.price_basis)) return current;
      const nextBasis = getRecyclingPriceBasis(nextUnit);
      const sameBasis = current.price_basis === nextBasis;
      const buy = sameBasis ? parseRecyclingUnitPrice(current.buy_price, current.price_unit) : null;
      const sell = sameBasis ? parseRecyclingUnitPrice(current.sell_price, current.price_unit) : null;
      return {
        ...current, price_unit: nextUnit, price_basis: nextBasis,
        buy_price: current.buy_price.trim() && buy !== null ? formatRecyclingUnitPrice(buy, nextUnit) : "",
        sell_price: current.sell_price.trim() && sell !== null ? formatRecyclingUnitPrice(sell, nextUnit) : ""
      };
    });
  }

  function closeEditor() {
    if (busy) return;
    setEditing(null);
    setPhotoFile(null);
    window.requestAnimationFrame(() => addButtonRef.current?.focus());
  }

  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        setEditing(null);
        setPhotoFile(null);
        window.requestAnimationFrame(() => addButtonRef.current?.focus());
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [editing, busy]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || busy) return;
    if (!editingBranchId || !branches.some(b => b.id === editingBranchId && b.canManage)) {
      setError("กรุณาเลือกสาขาที่ได้รับสิทธิ์ก่อนบันทึกวัสดุ");
      return;
    }
    if (editing.id && editingBranchId !== branchId) {
      setError("ไม่สามารถย้ายวัสดุข้ามสาขาด้วยการแก้ไขทะเบียนได้");
      return;
    }
    if (parseRecyclingUnitPrice(editing.buy_price, editing.price_unit) === null ||
        parseRecyclingUnitPrice(editing.sell_price, editing.price_unit) === null) {
      setError("กรุณาระบุราคาที่แปลงเป็นหน่วยฐานได้ตรงสตางค์: บาท/กก. 2, บาท/ขีด 3, บาท/กรัม 5 ตำแหน่ง");
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
          branch_id: editingBranchId,
          buy_price: editing.buy_price,
          sell_price: editing.sell_price
        })
      });
      const payload = await response.json().catch(() => null) as {
        data?: { material?: { id?: string } };
        error?: { message?: string; code?: string } | null;
      } | null;
      if (!response.ok) {
        setError(payload?.error?.message ?? "บันทึกสินค้าไม่สำเร็จ โปรดลองใหม่");
        return;
      }
      const savedId = payload?.data?.material?.id || editing.id;
      if (!savedId) { setError("ไม่พบรหัสวัสดุที่บันทึก โปรดรีเฟรช"); return; }
      if (photoFile) {
        try {
          const media = await optimizeRecyclingMaterialImage(photoFile);
          const form = new FormData();
          form.set("branch_id", editingBranchId);
          for(const key of ["display","thumbnail"] as const){
            const photo=media[key];
            form.set(key,photo.blob,key+"."+photo.extension);
            form.set(key+"_width",String(photo.size));
            form.set(key+"_height",String(photo.size));
          }
          const upload=await fetch("/api/pos/product-media/"+encodeURIComponent(savedId),{
            method:"POST",credentials:"same-origin",body:form});
          const result=await upload.json().catch(()=>null) as {data?:{asset?:unknown};error?:{message?:string}}|null;
          if(!upload.ok||!result?.data?.asset)throw new Error(result?.error?.message||"อัปโหลดภาพไม่สำเร็จ");
        }catch(cause){
          setEditing(current=>current?{...current,id:savedId}:current);
          setError("บันทึกทะเบียนวัสดุแล้ว แต่ภาพยังไม่สำเร็จ: "+
            (cause instanceof Error?cause.message:"กรุณาลองใหม่")+" · กดบันทึกอีกครั้งจะอัปโหลดรูปโดยไม่สร้างสินค้าใหม่");
          return;
        }
      }
      setEditing(null);setPhotoFile(null);
      setNotice("บันทึกวัสดุเรียบร้อยแล้ว");
      if (editingBranchId !== branchId) {
        router.push("/preview/pos/recycling/stock?branch_id=" + encodeURIComponent(editingBranchId));
      } else {
        router.refresh();
      }
    } catch {
      setError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์เพื่อบันทึกราคา");
    } finally {
      setBusy(false);
    }
  }

  function requestDelete(target: RecyclingCatalogItem|"all", trigger:HTMLButtonElement) {
    if (busy || !canManage) return;
    deleteTriggerRef.current=trigger;
    setDeleteTarget(target);setDeleteConfirmation("");setDeleteError("");setNotice("");
  }
  function cancelDelete() {
    if (busy) return;
    setDeleteTarget(null);setDeleteConfirmation("");setDeleteError("");
    window.requestAnimationFrame(()=>{
      if(deleteTriggerRef.current?.isConnected)deleteTriggerRef.current.focus();
      else addButtonRef.current?.focus();
    });
  }
  useEffect(()=>{
    if(!deleteTarget)return;
    const onEscape=(event:KeyboardEvent)=>{
      if(event.key==="Escape"&&!busy) {
        event.preventDefault();setDeleteTarget(null);setDeleteConfirmation("");setDeleteError("");
      }
    };
    document.addEventListener("keydown",onEscape);
    return ()=>document.removeEventListener("keydown",onEscape);
  },[deleteTarget,busy]);

  async function confirmDelete() {
    if(!deleteTarget||busy||!canManage)return;
    const isBulk=deleteTarget==="all";
    if(isBulk&&(deleteConfirmation.trim()!=="ลบทั้งหมด"||items.length===0)){
      setDeleteError("กรุณาพิมพ์คำว่า ลบทั้งหมด เพื่อยืนยัน");return;
    }
    setBusy(true);setDeleteError("");
    try{
      const response=await fetch("/api/pos/recycling/catalog",{
        method:"DELETE",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          branch_id:branchId,
          ...(isBulk?{delete_all:true,expected_count:items.length,confirmation:"ลบทั้งหมด"}
            :{id:deleteTarget.id,confirmation:"ลบรายการนี้"})
        })
      });
      const result=await response.json().catch(()=>null) as {
        data?:{deleted_count?:number}|null;error?:{message?:string}|null
      }|null;
      const count=result?.data?.deleted_count;
      if(!response.ok||typeof count!=="number"||count!==(isBulk?items.length:1)){
        setDeleteError(result?.error?.message??"ลบวัสดุไม่สำเร็จ กรุณารีเฟรชรายการแล้วลองใหม่");
        return;
      }
      setNotice(isBulk?`ลบวัสดุในสาขา ${branchName} ออกจากรายการแล้ว ${count} รายการ`
        :`ลบวัสดุ ${deleteTarget.name} ออกจากรายการแล้ว`);
      setDeleteTarget(null);setDeleteConfirmation("");
      router.refresh();window.requestAnimationFrame(()=>addButtonRef.current?.focus());
    }catch{
      setDeleteError("เชื่อมต่อระบบลบวัสดุไม่สำเร็จ กรุณาตรวจสอบสถานะก่อนกดซ้ำ");
    }finally{setBusy(false);}
  }

  return <main className="recycling-stock-layout flex h-full min-h-0 w-full flex-col overflow-hidden bg-white" data-testid="recycling-custom-stock">
    <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-3" data-testid="recycling-stock-toolbar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-extrabold text-slate-950">จัดการสินค้า <span className="ml-1 text-xs font-semibold text-blue-700">CUSTOM Recycling</span></h1>
          <p className="mt-0.5 text-xs text-slate-500">สาขา: {branchName} · ทะเบียนวัสดุเดียวสำหรับรับซื้อและขายออก</p>
        </div>
        <nav className="flex flex-wrap items-center gap-2" aria-label="ทางลัดหน้าจัดการวัสดุ">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
            สาขา
            <select data-testid="recycling-stock-branch-selector" aria-label="เลือกสาขาสำหรับดูทะเบียนวัสดุ"
              value={branchId} disabled={busy || Boolean(editing) || Boolean(deleteTarget)}
              onChange={event => router.push("/preview/pos/recycling/stock?branch_id=" + encodeURIComponent(event.target.value))}
              className="h-10 max-w-[220px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 focus:border-blue-600 focus:outline-none">
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <Link href="/preview/pos/more" className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            ← กลับเมนูเพิ่มเติม
          </Link>
          {canManage && <button ref={addButtonRef} type="button" onClick={() => edit()}
            className="inline-flex min-h-10 items-center rounded-lg bg-blue-700 px-4 text-sm font-extrabold text-white hover:bg-blue-800">
            + เพิ่มวัสดุ
          </button>}
        </nav>
      </div>
    </header>

    {notice && <p role="status" className="mx-3 mt-2 shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800">{notice}</p>}

    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="ทะเบียนวัสดุ" data-testid="recycling-stock-table-area">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/60 px-4 py-3">
        <div>
          <h2 className="text-sm font-extrabold text-slate-900">รายการวัสดุในสาขา <span className="ml-2 font-normal text-slate-500">ทั้งหมด {items.length} · ตั้งราคาครบ {items.length - incomplete} · รอตั้งราคา {incomplete}</span></h2>
          <p className="mt-1 text-xs text-slate-500">ราคาซื้อเข้าและราคาขายออกแยกกัน · ยอดคงเหลือเปลี่ยนตามธุรกรรมที่บันทึกจริงเท่านั้น</p>
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
              <td className="px-3 py-2">{(mediaByProduct[item.id] || item.imageUrl)
                ? <Image src={mediaByProduct[item.id] || item.imageUrl!} alt={item.name} width={48} height={48} unoptimized className="h-11 w-11 rounded-lg object-cover"/>
                : <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-xl" aria-label="ยังไม่มีภาพวัสดุ">♻️</span>}</td>
              <td className="px-3 py-2">
  <button type="button" className="group flex max-w-[160px] flex-col items-center rounded-lg border border-transparent p-1 hover:border-blue-300 hover:bg-blue-50"
    aria-label={"แสดงและพิมพ์บาร์โค้ด "+item.sku} onClick={()=>setBarcodeItem(item)}>
    <RecyclingBarcodeMark sku={item.sku} compact/>
    <span className="mt-1 break-all font-mono text-xs font-semibold text-blue-700 group-hover:underline">{item.sku}</span>
  </button>
</td>
              <td className="px-3 py-2 font-bold text-slate-900">{item.name}</td>
              <td className="px-3 py-2 text-slate-600">{item.category}</td>
              <td className="px-3 py-2 text-right font-bold tabular-nums text-blue-700">{item.buyPrice === null ? "ยังไม่กำหนด" : formatRecyclingUnitPrice(item.buyPrice,item.priceUnit)}</td>
              <td className="px-3 py-2 text-right font-bold tabular-nums text-emerald-700">{item.sellPrice === null ? "ยังไม่กำหนด" : formatRecyclingUnitPrice(item.sellPrice,item.priceUnit)}</td>
              <td className="px-3 py-2 text-slate-600">บาท/{RECYCLING_PRICE_UNIT_LABELS[item.priceUnit]} <small className="block text-[11px] text-slate-400">สต๊อกฐาน: {item.priceBasis === "kg" ? "กก." : "ชิ้น"}</small></td>
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

    {barcodeItem && <RecyclingBarcodeDialog item={barcodeItem} branchId={branchId} branchName={branchName} onClose={()=>setBarcodeItem(null)}/>}
    {editing && <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-950/70 p-3"
      role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeEditor(); }}>
      <form onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="material-editor-title" aria-describedby="material-editor-description"
        className="flex max-h-[92vh] w-full max-w-[760px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
        data-testid="recycling-material-editor">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-blue-50 px-5 py-3.5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-blue-700">CUSTOM Recycling · จัดการสินค้า</p>
            <h3 id="material-editor-title" className="mt-1 text-xl font-extrabold text-slate-950">{editing.id ? "แก้ไขข้อมูลวัสดุ" : "เพิ่มวัสดุใหม่"}</h3>
            <p id="material-editor-description" className="mt-1 text-xs text-slate-600">บาร์โค้ดเดียวกันใช้ได้ทั้งรับซื้อและขายออก โดยแยกราคาแต่ละประเภท</p>
          </div>
          <button type="button" disabled={busy} onClick={closeEditor} aria-label="ปิดหน้าต่างเพิ่มวัสดุ"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-white text-lg text-slate-600 hover:bg-slate-100 disabled:opacity-50">×</button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <section className="rounded-lg border border-blue-200 bg-blue-50/50 p-3" aria-label="สาขาที่บันทึกวัสดุ">
            <label className="block text-xs font-extrabold text-blue-950">เลือกสาขาที่จะบันทึกวัสดุ <span className="text-rose-600">*</span>
              <select required data-testid="recycling-stock-editor-branch" value={editingBranchId}
                disabled={Boolean(editing.id) || busy}
                onChange={event => setEditingBranchId(event.target.value)}
                className="mt-2 block h-11 w-full rounded-lg border border-blue-200 bg-white px-3 text-sm font-semibold text-slate-900 disabled:bg-slate-100">
                <option value="">-- เลือกสาขาก่อนเพิ่มวัสดุ --</option>
                {branches.filter(b => b.canManage).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <p className="mt-2 text-xs text-slate-600">วัสดุและราคาจะแยกตามสาขาที่เลือก · ไม่โอนสต๊อกข้ามสาขาโดยอัตโนมัติ</p>
          </section>
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
                <select value={editing.price_unit}
                  onChange={event => selectPriceUnit(event.target.value as RecyclingPriceUnit)}
                  className="mt-1 block h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-600 focus:outline-none">
                  <option value="kg" disabled={Boolean(editing.id) && editing.price_basis === "piece"}>กิโลกรัม (บาท/กก.)</option>
                  <option value="khid" disabled={Boolean(editing.id) && editing.price_basis === "piece"}>ขีด (บาท/ขีด)</option>
                  <option value="g" disabled={Boolean(editing.id) && editing.price_basis === "piece"}>กรัม (บาท/กรัม)</option>
                  <option value="piece" disabled={Boolean(editing.id) && editing.price_basis === "kg"}>ชิ้น (บาท/ชิ้น)</option>
                </select>
              </label>
            </div>
            <p className="text-xs font-medium text-slate-600">สามารถสลับหน่วย กก. / ขีด / กรัม โดยแปลงราคาอ้างอิงอย่างแม่นยำ · ยอดสต๊อกใช้กิโลกรัมเหมือนเดิม {editing.id ? "· ห้ามเปลี่ยนระหว่างหน่วยน้ำหนักกับหน่วยชิ้นหลังบันทึกทะเบียน" : ""}</p>
          </fieldset>

          <fieldset className="space-y-3 border-t border-slate-200 pt-4">
            <legend className="text-sm font-extrabold text-slate-900">กำหนดราคาแยกตามธุรกรรม</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block rounded-lg border border-blue-200 bg-blue-50/60 p-3 text-sm font-bold text-blue-900">
                ราคารับซื้อเข้าร้าน (บาท/{RECYCLING_PRICE_UNIT_LABELS[editing.price_unit]})
                <input required min="0" max="99999999" step="any" type="number" inputMode="decimal" value={editing.buy_price}
                  onChange={event => setEditing(current => current ? {...current, buy_price:event.target.value} : null)}
                  placeholder="0.00" className="mt-2 block h-11 w-full rounded-lg border border-blue-200 bg-white px-3 text-base tabular-nums text-slate-900 outline-none focus:border-blue-600"/>
                <small className="mt-2 block text-xs font-normal text-blue-800">ใช้ตอนร้านจ่ายเงิน · ราคาอ้างอิง {parseRecyclingUnitPrice(editing.buy_price,editing.price_unit) === null ? "—" : money(parseRecyclingUnitPrice(editing.buy_price,editing.price_unit))} บาท/{editing.price_basis === "kg" ? "กก." : "ชิ้น"}</small>
              </label>
              <label className="block rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-sm font-bold text-emerald-900">
                ราคาขายออก (บาท/{RECYCLING_PRICE_UNIT_LABELS[editing.price_unit]})
                <input required min="0" max="99999999" step="any" type="number" inputMode="decimal" value={editing.sell_price}
                  onChange={event => setEditing(current => current ? {...current, sell_price:event.target.value} : null)}
                  placeholder="0.00" className="mt-2 block h-11 w-full rounded-lg border border-emerald-200 bg-white px-3 text-base tabular-nums text-slate-900 outline-none focus:border-emerald-600"/>
                <small className="mt-2 block text-xs font-normal text-emerald-800">ใช้ตอนร้านรับชำระเงิน · ราคาอ้างอิง {parseRecyclingUnitPrice(editing.sell_price,editing.price_unit) === null ? "—" : money(parseRecyclingUnitPrice(editing.sell_price,editing.price_unit))} บาท/{editing.price_basis === "kg" ? "กก." : "ชิ้น"}</small>
              </label>
            </div>
          </fieldset>

          <fieldset className="space-y-2 border-t border-slate-200 pt-4">
            <legend className="text-sm font-extrabold text-slate-900">รูปภาพวัสดุ (ไม่บังคับ)</legend>
            <div className="flex items-center gap-3">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-2xl">
                {Boolean(photoPreview || mediaByProduct[editing.id ?? ""] || isValidHttpsImagePreview(editing.image_url.trim()))
                  ? <Image src={photoPreview || mediaByProduct[editing.id ?? ""] || editing.image_url.trim()} alt="ตัวอย่างรูปวัสดุ" width={64} height={64} unoptimized className="h-full w-full object-cover"/>
                  : <span aria-hidden="true">♻️</span>}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <label className="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-blue-300 bg-blue-50 px-3 text-sm font-bold text-blue-800 hover:bg-blue-100">
                  {photoFile ? photoFile.name : "คลิกเลือกรูปภาพจากเครื่อง"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} className="sr-only"
                    onChange={event=>{
                      const file=event.target.files?.[0]??null;event.target.value="";
                      if(!file)return;
                      if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size<=0||file.size>20*1024*1024){
                        setError("รองรับ JPG, PNG, WebP ไม่เกิน 20 MB");return;
                      }
                      setPhotoFile(file);setError("");
                    }}/>
                </label>
                <p className="text-xs text-slate-500">ย่อภาพ 1200px/400px ตามมาตรฐาน Product Media และโควตาแพ็กเกจเดิม</p>
                <label className="block text-xs font-semibold text-slate-700">หรือใช้ลิงก์ HTTPS
                  <input type="url" maxLength={1000} value={editing.image_url}
                    onChange={e=>setEditing(current=>current?{...current,image_url:e.target.value}:null)}
                    placeholder="https://..." className="mt-1 block h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"/>
                </label>
              </div>
            </div>
          </fieldset>
          {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3">
          <p className="max-w-xs text-xs text-slate-500">สาขาที่เลือก: {branches.find(b => b.id === editingBranchId)?.name ?? "ยังไม่เลือก"} · การเพิ่มวัสดุไม่ใช่การเพิ่มยอดสต๊อก</p>
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
