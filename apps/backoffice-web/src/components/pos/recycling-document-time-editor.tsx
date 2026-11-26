"use client";
import {useEffect,useId,useRef,useState} from "react";
import {bangkokLocalDateTime,parseRecyclingDocumentTime} from "@/lib/recycling-document-time";
export function RecyclingDocumentTimeEditor({id,currentAt,source,onSaved,receiptNo,direction,amountMinor}:{id:string;currentAt:string;source:"pos"|"finance";onSaved:()=>void;receiptNo?:string;direction?:"buy"|"sell";amountMinor?:number}){
 const [open,setOpen]=useState(false),[value,setValue]=useState(""),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const retry=useRef<{id:string;payload:string}|null>(null),inFlight=useRef(false);
 const trigger=useRef<HTMLButtonElement>(null),input=useRef<HTMLInputElement>(null);
 const titleId=useId();
 useEffect(()=>{if(open)window.requestAnimationFrame(()=>input.current?.focus());},[open]);
 function close(){if(inFlight.current)return;setOpen(false);window.requestAnimationFrame(()=>trigger.current?.focus());}
 async function save(){
  if(inFlight.current)return;
  if(!parseRecyclingDocumentTime(value,new Date())||reason.trim().length<10){setError("กรุณาระบุวันเวลาและเหตุผลอย่างน้อย 10 ตัวอักษร");return;}
  const payload=JSON.stringify({expected_at:currentAt,document_time:value,reason:reason.trim()});
  if(!retry.current||retry.current.payload!==payload)retry.current={id:crypto.randomUUID(),payload};
  const requestId=retry.current.id;
  inFlight.current=true;setBusy(true);setError("");
  try{
   const prefix=source==="pos"?"/api/pos/recycling/transactions/":"/api/finance/recycling/transactions/";
   const res=await fetch(prefix+encodeURIComponent(id)+"/document-time",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({...JSON.parse(payload),request_id:requestId})});
   const result=await res.json().catch(()=>null);
   if(!res.ok||result?.data?.applied!==true){setError(result?.error?.message??"ไม่สามารถยืนยันการบันทึกได้");return;}
   retry.current=null;setOpen(false);onSaved();window.requestAnimationFrame(()=>trigger.current?.focus());
  }catch{setError("การเชื่อมต่อขัดข้อง กรุณาตรวจสอบข้อมูลก่อนส่งซ้ำ");}
  finally{inFlight.current=false;setBusy(false);}
 }

 return <><button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open} data-testid="recycling-direct-edit-button" className="min-h-9 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-800 hover:bg-blue-100" onClick={()=>{setValue(bangkokLocalDateTime(new Date(currentAt)));setReason("");setError("");setOpen(true);}}>{source==="pos"?"แก้ไขบิล":"แก้ไขวันที่ / เวลา"}</button>
 {open&&<div className="fixed inset-0 z-[1900] flex items-center justify-center bg-slate-950/50 p-3 sm:p-5" role="presentation">
 <form role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="recycling-direct-edit-modal" className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white text-left shadow-2xl" onSubmit={e=>{e.preventDefault();void save();}} onKeyDown={e=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();close();}}}>
 <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><h3 id={titleId} className="text-lg font-extrabold text-slate-900">แก้ไขบิลรับซื้อ–ขายออก</h3><p className="mt-1 text-xs text-slate-500">{receiptNo??"เอกสาร Recycling"}{direction?" · "+(direction==="buy"?"รับซื้อเข้าร้าน":"ขายออก"):""}</p></div><button type="button" disabled={busy} aria-label="ปิดหน้าต่างแก้ไข" onClick={close} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600">ปิด (Esc)</button></header>
 <div className="space-y-4 overflow-y-auto px-5 py-4">
 <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-3 text-sm"><span className="font-medium text-slate-600">วันเวลาเอกสารเดิม</span><span className="font-bold text-slate-900">{new Date(currentAt).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</span>{typeof amountMinor==="number"&&<><span className="w-full border-t border-slate-200 pt-2 text-xs text-slate-500">ยอดบิล {(amountMinor/100).toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</span></>}</div>
 <label className="block text-sm font-bold text-slate-800">วันที่และเวลาใหม่<input ref={input} type="datetime-local" step={1} required disabled={busy} value={value} max={bangkokLocalDateTime(new Date())} onChange={e=>{setValue(e.target.value);setError("");}} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white p-3 font-normal outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"/></label>
 <label className="block text-sm font-bold text-slate-800">เหตุผลการแก้ไข<textarea required rows={3} minLength={10} maxLength={500} disabled={busy} value={reason} onChange={e=>{setReason(e.target.value);setError("");}} placeholder="ระบุเหตุผลอย่างน้อย 10 ตัวอักษร" className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 p-3 font-normal outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"/></label>
 <p className="text-xs leading-5 text-slate-500">บันทึกโดยตรงเมื่อมีสิทธิ์ · ใช้วันเวลาเอกสารเดียวกันใน POS และ Finance · เก็บประวัติวันเวลาบันทึกจริงไว้</p>
 {error&&<p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
 </div>
 <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4"><button type="button" disabled={busy} className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700" onClick={close}>ยกเลิก</button><button type="submit" disabled={busy||reason.trim().length<10} className="min-h-11 rounded-lg bg-blue-700 px-5 text-sm font-bold text-white disabled:opacity-40">{busy?"กำลังบันทึก...":"บันทึกการแก้ไข"}</button></footer>
 </form></div>}</>;
}
