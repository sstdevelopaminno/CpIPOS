"use client";
import {useRef,useState} from "react";
import {bangkokLocalDateTime,parseRecyclingDocumentTime} from "@/lib/recycling-document-time";
export function RecyclingDocumentTimeEditor({id,currentAt,source,onSaved}:{id:string;currentAt:string;source:"pos"|"finance";onSaved:()=>void}){
 const [open,setOpen]=useState(false),[value,setValue]=useState(""),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const retry=useRef<{id:string;payload:string}|null>(null);
 const inFlight=useRef(false);
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
   retry.current=null;setOpen(false);onSaved();
  }catch{setError("การเชื่อมต่อขัดข้อง กรุณาตรวจสอบข้อมูลก่อนส่งซ้ำ");}
  finally{inFlight.current=false;setBusy(false);}
 }
 return <><button type="button" className="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-800" onClick={()=>{setValue(bangkokLocalDateTime(new Date(currentAt)));setReason("");setError("");setOpen(true);}}>แก้ไขวันที่ / เวลา</button>
 {open&&<div className="fixed inset-0 z-[1900] flex items-center justify-center bg-slate-950/60 p-4" role="presentation"><form role="dialog" aria-modal="true" aria-label="แก้ไขวันที่และเวลาเอกสาร" className="w-full max-w-md space-y-3 rounded-xl bg-white p-5 text-left shadow-xl" onSubmit={e=>{e.preventDefault();void save();}} onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();if(!busy)setOpen(false);}}}>
 <h3 className="text-lg font-extrabold">แก้ไขวันที่และเวลาเอกสาร</h3>
 <p className="text-xs text-slate-600">เปลี่ยนวันที่เอกสารในทะเบียน POS และ Finance โดยเก็บเวลาบันทึกจริงไว้ ไม่เปลี่ยนยอดเงินหรือกะ</p>
 <label className="block text-sm font-bold">วันเวลา (ประเทศไทย)<input type="datetime-local" step={1} required disabled={busy} value={value} max={bangkokLocalDateTime(new Date())} onChange={e=>setValue(e.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2"/></label>
 <label className="block text-sm font-bold">เหตุผล<textarea required minLength={10} maxLength={500} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2"/></label>
 {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
 <div className="flex justify-end gap-2"><button type="button" disabled={busy} className="rounded border px-3 py-2" onClick={()=>setOpen(false)}>ปิด</button><button type="submit" disabled={busy} className="rounded bg-blue-700 px-3 py-2 font-bold text-white">{busy?"กำลังบันทึก":"บันทึกการแก้ไข"}</button></div>
 </form></div>}</>;
}
