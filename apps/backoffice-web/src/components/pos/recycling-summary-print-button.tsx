"use client";

import { useEffect,useRef,useState } from "react";
import type {RecyclingReportQuery} from "@/lib/server/recycling-history-reports";

/** Print is manual and only initiated from the second confirmation button.
 * Opening the dialog cannot queue any print job.
 */
export function RecyclingSummaryPrintButton({filters}:{filters:RecyclingReportQuery}){
 const [open,setOpen]=useState(false);
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[error,setError]=useState("");
 const [attempted,setAttempted]=useState(false);
 const closeRef=useRef<HTMLButtonElement>(null);
 const openRef=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(open)window.requestAnimationFrame(()=>closeRef.current?.focus());
 },[open]);
 const close=()=>{
  if(busy)return;
  setOpen(false);
  window.requestAnimationFrame(()=>openRef.current?.focus());
 };
 async function run(){
  if(!open||busy||attempted)return;
  setBusy(true);setAttempted(true);setNotice("");setError("");
  try{
   const response=await fetch("/api/pos/recycling/reports/print",{
    method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({request_id:crypto.randomUUID(),filters})
   });
   const data=await response.json().catch(()=>null) as {
    data?:{queued?:boolean;jobs?:Array<{id:string;status:string}>};
    error?:{message?:string};
   }|null;
   if(!response.ok||!data?.data?.queued){
    setError(data?.error?.message??"ไม่สามารถส่งรายงานไปยังเครื่องพิมพ์ได้");
    return;
   }
   const jobs=data.data.jobs??[];
   if(jobs.some(j=>j.status==="failed")){
    setError("งานพิมพ์ไม่สำเร็จ กรุณาตรวจเครื่องและคิว Print Agent");
    return;
   }
   setNotice(jobs.length===0?"อาจมีคิวพิมพ์เดิมแล้ว กรุณาตรวจคิวที่เครื่องพิมพ์":
    jobs.every(j=>j.status==="printed")?"เครื่องพิมพ์ยืนยันการพิมพ์แล้ว":
    "ส่งรายงานเข้าคิว Print Agent แล้ว กรุณาตรวจการพิมพ์ที่เครื่อง");
  }catch{
   setError("ไม่สามารถยืนยันผลจาก Print Agent ได้ กรุณาตรวจคิวก่อนพิมพ์ซ้ำ");
  }finally{setBusy(false);}
 }
 return <>
  <button type="button" ref={openRef}
   data-testid="recycling-summary-print-open"
   onClick={()=>{setNotice("");setError("");setAttempted(false);setOpen(true);}}
   className="min-h-10 rounded-md border border-blue-300 bg-white px-3 text-xs font-semibold text-blue-700">
   พิมพ์สรุปรับซื้อ–ขายออก (58/80 มม.)
  </button>
  {open&&<div role="presentation" className="fixed inset-0 z-[1760] flex items-center justify-center bg-slate-950/70 p-3 sm:p-5">
   <section role="dialog" aria-modal="true" aria-labelledby="recycling-summary-print-title"
    data-testid="recycling-summary-print-confirm"
    onKeyDown={e=>{if(e.key==="Escape"&&!busy){e.preventDefault();e.stopPropagation();close();}}}
    className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
     <div>
      <h2 id="recycling-summary-print-title" className="text-base font-extrabold text-slate-900">
       ตรวจสอบก่อนพิมพ์รายงาน Recycling
      </h2>
      <p className="mt-1 text-xs text-slate-600">รับซื้อ–ขายออก · กระดาษ 58/80 มม. ตามการตั้งค่าเครื่องพิมพ์</p>
     </div>
     <button type="button" ref={closeRef} disabled={busy} onClick={close}
      className="min-h-9 rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-50">
      ปิด (Esc)
     </button>
    </header>
    <div className="space-y-3 px-4 py-4 text-sm text-slate-800">
     <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-6">
      <p><strong>ช่วงเวลา:</strong> {filters.period==="day"?"รายวัน":filters.period==="month"?"รายเดือน":filters.period==="year"?"รายปี":"กำหนดเอง"}</p>
      <p><strong>ตั้งแต่:</strong> {filters.from??filters.date??"—"} <strong>ถึง:</strong> {filters.to??filters.date??"—"}</p>
      <p><strong>ประเภท:</strong> {filters.direction==="buy"?"รับซื้อ":filters.direction==="sell"?"ขายออก":"รับซื้อและขายออก"}</p>
      <p><strong>สถานะ:</strong> {filters.status==="posted"?"บันทึกแล้ว":filters.status==="voided"?"ยกเลิก (VOID)":"ทุกสถานะ"}</p>
     </div>
     <p className="text-xs leading-5 text-slate-600">
      ระบบจะส่งรายงานที่ผ่านสิทธิ์สาขาและเงื่อนไขตัวกรองไปยัง Print Agent
      กดปุ่มยืนยันแล้วจึงสร้างคิวพิมพ์ ไม่สร้างรายการเงินหรือสต๊อกใหม่
     </p>
     {notice&&<p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800">{notice}</p>}
     {error&&<p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-bold text-rose-800">{error}</p>}
    </div>
    <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
     <button type="button" disabled={busy} onClick={close}
      className="min-h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700">กลับ</button>
     <button type="button" disabled={busy||attempted} onClick={()=>void run()}
      data-testid="recycling-summary-print-final"
      className="min-h-10 rounded-md bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-45">
      {busy?"กำลังส่งเข้าคิว...":"ยืนยันพิมพ์รายงาน"}
     </button>
    </footer>
   </section>
  </div>}
 </>;
}
