"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { parseRetailPriceSetting } from "@/lib/retail-wholesale/stock-display";
type Product={id:string;name:string;updated_at?:string;rw_online_price?:number|null;rw_wholesale_price?:number|null};
export function RetailPriceSetupButton({th,branchId,product}:{th:boolean;branchId:string;product:Product}){
  const router=useRouter();
  const [open,setOpen]=useState(false),[online,setOnline]=useState(""),[wholesale,setWholesale]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function save(){
    const a=parseRetailPriceSetting(online),b=parseRetailPriceSetting(wholesale);
    if(!a.ok||!b.ok){setError(th?"ราคาไม่ถูกต้อง":"Invalid price");return;}
    setBusy(true);setError("");
    try{
      const res=await fetch("/api/backoffice/catalog",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"set_rw_prices",branch_id:branchId,product_id:product.id,expected_updated_at:product.updated_at,online_price:a.value,wholesale_price:b.value})});
      const data=await res.json();
      if(!res.ok||data.error)throw new Error(data.error?.message??(th?"บันทึกไม่สำเร็จ":"Save failed"));
      setOpen(false);router.refresh();
    }catch(e){setError(e instanceof Error?e.message:"Save failed");}finally{setBusy(false);}
  }
  return <>
    <button type="button" disabled={!product.updated_at} className="min-h-8 whitespace-nowrap rounded border border-blue-200 px-2 text-xs font-bold text-blue-700 disabled:opacity-50" onClick={()=>{setOnline(product.rw_online_price==null?"":String(product.rw_online_price));setWholesale(product.rw_wholesale_price==null?"":String(product.rw_wholesale_price));setError("");setOpen(true);}}>{th?"ตั้งราคา":"Prices"}</button>
    {open?<div role="dialog" aria-modal="true" aria-label={th?"ตั้งราคา RW":"RW price settings"} className="fixed inset-0 z-[175] grid place-items-center bg-slate-900/40 p-4">
      <div className="grid w-full max-w-md gap-3 rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-extrabold">{product.name}</h3>
        <p className="text-xs text-slate-600">{th?"บันทึกราคาออนไลน์และราคาส่งไว้ในทะเบียนสินค้าเท่านั้น ยังไม่ใช้คิดเงินหน้าขาย · เว้นว่างหากยังไม่ตั้งราคา":"Catalogue prices only; not yet used by checkout. Blank means unset."}</p>
        <label className="grid gap-1 text-sm">{th?"ราคาขายออนไลน์":"Online price"}<input type="number" min="0" step="0.01" value={online} onChange={e=>setOnline(e.target.value)} disabled={busy} className="rounded border p-2"/></label>
        <label className="grid gap-1 text-sm">{th?"ราคาขายส่ง":"Wholesale price"}<input type="number" min="0" step="0.01" value={wholesale} onChange={e=>setWholesale(e.target.value)} disabled={busy} className="rounded border p-2"/></label>
        {error?<p role="alert" className="text-sm text-red-700">{error}</p>:null}
        <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={()=>setOpen(false)} className="rounded border px-3 py-2">{th?"ยกเลิก":"Cancel"}</button><button type="button" disabled={busy} onClick={()=>void save()} className="rounded bg-blue-600 px-3 py-2 font-bold text-white">{busy?(th?"กำลังบันทึก":"Saving"):(th?"บันทึก":"Save")}</button></div>
      </div>
    </div>:null}
  </>;
}
