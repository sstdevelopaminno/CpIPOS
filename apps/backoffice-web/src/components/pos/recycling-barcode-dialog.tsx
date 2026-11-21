"use client";
import { useState } from "react";
import type { RecyclingCatalogItem } from "@/lib/server/recycling-pos-service";
import { opticalCode128Svg } from "@/lib/optical/optical-code128-barcode";

export function recyclingBarcodeMarkup(sku:string):string|null{
 try{return opticalCode128Svg(sku)}catch{return null}
}
/** SVG is exclusively generated from the immutable Code128 pattern table, never raw SKU markup. */
export function RecyclingBarcodeMark({sku,compact=false}:{sku:string;compact?:boolean}){
 const markup=recyclingBarcodeMarkup(sku);
 if(!markup)return <span className="text-[11px] text-amber-700">รหัสนี้ไม่รองรับบาร์โค้ด</span>;
 return <span aria-hidden="true" className={compact
   ?"block w-28 [&_svg]:h-8 [&_svg]:w-full"
   :"block w-full max-w-[440px] [&_svg]:h-auto [&_svg]:w-full"}
   dangerouslySetInnerHTML={{__html:markup}}/>;
}
export function RecyclingBarcodeDialog({item,branchId,branchName,onClose}:{
 item:RecyclingCatalogItem;branchId:string;branchName:string;onClose:()=>void
}){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[error,setError]=useState("");
 const valid=Boolean(recyclingBarcodeMarkup(item.sku));
 async function print(){
  if(!valid||busy)return;
  setBusy(true);setError("");setNotice("");
  try{
   const response=await fetch("/api/pos/recycling/barcodes/print",{
    method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({request_id:crypto.randomUUID(),product_id:item.id,branch_id:branchId})
   });
   const body=await response.json().catch(()=>null) as {
    data?:{jobs?:Array<{status?:string}>};error?:{message?:string}
   }|null;
   if(!response.ok||!body?.data?.jobs?.length){setError(body?.error?.message||"ส่งคำสั่งพิมพ์ไม่สำเร็จ");return;}
   if(body.data.jobs.some(job=>job.status==="failed"))setError("คิวพิมพ์ล้มเหลว กรุณาตรวจ Print Agent");
   else setNotice(body.data.jobs.every(job=>job.status==="printed")
     ?"เครื่องพิมพ์ยืนยันการพิมพ์แล้ว"
     :"ส่งฉลากบาร์โค้ดเข้าคิว Print Agent แล้ว โปรดตรวจเครื่องพิมพ์");
  }catch{setError("เชื่อมต่อเซิร์ฟเวอร์พิมพ์ไม่สำเร็จ");}
  finally{setBusy(false);}
 }
 return <div className="fixed inset-0 z-[1210] flex items-center justify-center bg-slate-950/70 p-3"
   role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}>
   <section role="dialog" aria-modal="true" aria-label={"บาร์โค้ด "+item.name}
     className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
    <header className="flex items-start justify-between gap-3">
     <div><p className="text-xs font-bold text-blue-700">CUSTOM Recycling · {branchName}</p>
      <h2 className="mt-1 text-lg font-extrabold text-slate-900">บาร์โค้ดวัสดุ · {item.name}</h2></div>
     <button type="button" disabled={busy} onClick={onClose} aria-label="ปิดหน้าต่างบาร์โค้ด"
       className="h-9 w-9 rounded-lg border border-slate-300 text-lg">×</button>
    </header>
    <div className="mt-4 flex flex-col items-center rounded-lg border border-slate-200 bg-white p-5">
     <RecyclingBarcodeMark sku={item.sku}/>
     <strong className="mt-2 break-all font-mono text-base tracking-wide">{item.sku}</strong>
     <p className="mt-1 text-xs text-slate-500">Code 128 · ใช้รหัสเดียวทั้งรับซื้อและขายออก</p>
    </div>
    {!valid&&<p role="alert" className="mt-3 text-sm text-amber-800">รหัสต้องเป็น ASCII ที่พิมพ์ได้ ไม่เกิน 60 ตัวอักษร จึงแสดงบาร์โค้ด Code 128 ได้</p>}
    <p className="mt-3 text-xs text-slate-600">พิมพ์ฉลากผ่านเครื่องใบเสร็จ 58/80 มม. ที่ผูกกับเครื่อง POS สาขานี้ · ไม่บันทึกบิลและไม่เปลี่ยนสต๊อก</p>
    {notice&&<p role="status" className="mt-3 text-sm text-emerald-800">{notice}</p>}
    {error&&<p role="alert" className="mt-3 text-sm text-rose-800">{error}</p>}
    <footer className="mt-5 flex justify-end gap-2">
     <button type="button" disabled={busy} onClick={onClose} className="min-h-10 rounded-lg border border-slate-300 px-4 font-bold text-slate-700">ปิด</button>
     <button type="button" disabled={busy||!valid} onClick={()=>void print()}
       className="min-h-10 rounded-lg bg-blue-700 px-5 font-bold text-white disabled:opacity-50">{busy?"กำลังส่งพิมพ์...":"พิมพ์บาร์โค้ด 58/80 มม."}</button>
    </footer>
   </section>
  </div>;
}
