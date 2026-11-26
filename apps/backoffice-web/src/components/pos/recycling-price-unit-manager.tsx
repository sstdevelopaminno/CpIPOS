"use client";
import {useEffect,useState,useCallback} from "react";
import {priceUnitLabel,isCustomRecyclingUnit,type RecyclingPriceUnit} from "@/lib/recycling-price-units";
export type PriceUnitRow={code:RecyclingPriceUnit;active:boolean};
export function RecyclingPriceUnitManager({branchId,canManage,onClose,onChange}:{branchId:string;canManage:boolean;onClose:()=>void;onChange:(rows:PriceUnitRow[])=>void}){
 const [rows,setRows]=useState<PriceUnitRow[]>([]),[name,setName]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const url="/api/pos/recycling/price-units?branch_id="+encodeURIComponent(branchId);
 const load=useCallback(async()=>{try{const r=await fetch(url,{credentials:"same-origin",cache:"no-store"});const j=await r.json();if(!r.ok||!Array.isArray(j?.data?.units))throw Error(j?.error?.message??"โหลดหน่วยไม่สำเร็จ");setRows(j.data.units);onChange(j.data.units);setError("");}catch(e){setError(e instanceof Error?e.message:"โหลดหน่วยไม่สำเร็จ");}},[url,onChange]);
 useEffect(()=>{void load();},[load]);
 async function save(method:"POST"|"DELETE",body:Record<string,unknown>){
  if(busy||!canManage)return;setBusy(true);setError("");
  try{const r=await fetch(url,{method,credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const j=await r.json();if(!r.ok||!Array.isArray(j?.data?.units))throw Error(j?.error?.message??"บันทึกไม่สำเร็จ");setRows(j.data.units);onChange(j.data.units);setName("");}catch(e){setError(e instanceof Error?e.message:"บันทึกไม่สำเร็จ");}finally{setBusy(false);}
 }
 return <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-slate-950/60 p-3">
 <section role="dialog" aria-modal="true" aria-label="จัดการหน่วยราคามาตรฐาน" className="w-full max-w-lg max-h-[85vh] overflow-auto rounded-xl bg-white p-5 shadow-xl">
  <header className="flex items-center justify-between"><h2 className="text-lg font-bold">จัดการหน่วยราคามาตรฐาน</h2><button type="button" disabled={busy} onClick={onClose} className="rounded border px-3 py-2">ปิด</button></header>
  <p className="my-2 text-sm text-slate-600">หน่วยที่เพิ่มเองเป็นหน่วยนับจำนวนเต็ม (บาทต่อหน่วย) สำหรับสาขาที่เลือก</p>
  {canManage&&<div className="my-3 flex gap-2"><input aria-label="ชื่อหน่วยใหม่" value={name} maxLength={24} onChange={e=>setName(e.target.value)} placeholder="เช่น แพ็ก มัด ใบ" className="min-w-0 flex-1 rounded border p-2"/><button type="button" disabled={busy||!name.trim()} onClick={()=>void save("POST",{action:"add",label:name})} className="rounded bg-blue-700 px-3 py-2 font-bold text-white disabled:opacity-50">+ เพิ่ม</button></div>}
  {error&&<p role="alert" className="my-2 rounded bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
  <div className="divide-y rounded border">{rows.filter(r=>r.active).map(r=><div key={r.code} className="flex items-center justify-between gap-2 p-3"><span>{priceUnitLabel(r.code)} <small className="text-slate-500">{isCustomRecyclingUnit(r.code)?"กำหนดเอง":"มาตรฐาน"}</small></span>{canManage&&<button type="button" disabled={busy} onClick={()=>{if(window.confirm("นำหน่วย "+priceUnitLabel(r.code)+" ออกจากรายการเลือกสินค้าใหม่? สินค้าเดิมและประวัติจะยังคงอยู่"))void save("DELETE",{code:r.code,confirmed:true});}} className="rounded border border-rose-200 px-2 py-1 text-sm text-rose-700">ลบ</button>}</div>)}</div>
  {rows.some(r=>!r.active)&&<details className="mt-3"><summary className="cursor-pointer text-sm font-bold">หน่วยที่ลบออกจากรายการ</summary>{rows.filter(r=>!r.active).map(r=><div key={r.code} className="flex items-center justify-between border-b p-2 text-sm"><span>{priceUnitLabel(r.code)}</span>{canManage&&<button type="button" disabled={busy} onClick={()=>void save("POST",{action:"restore",code:r.code})} className="rounded border px-2 py-1">คืนหน่วย</button>}</div>)}</details>}
 </section></div>;
}
