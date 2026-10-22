"use client";
import {useEffect,useRef,useState} from "react";
import type {Language} from "@/lib/i18n";
import {opticalDetailText,opticalDetailDate} from "@/lib/optical-detail-i18n";
type Customer={id:string;customer_code:string;full_name:string;phone:string|null;age:number|null;last_exam_date:string|null;examiner_name:string|null;previous_prescription:string|null;notes:string|null};
type Exam={id:string;examined_at:string;right_sph:number|null;right_cyl:number|null;right_axis:number|null;right_add:number|null;left_sph:number|null;left_cyl:number|null;left_axis:number|null;left_add:number|null;pd_mm:number|null;examiner_name:string|null};
type Detail={customer:Customer;exams:Exam[];canArchive:boolean};
export function PosOpticalCustomerDetailDialog({id,onClose,onChanged,lang}:{
 id:string;onClose:()=>void;onChanged:()=>void;lang:Language;
}){
 const txt=(thai:string)=>opticalDetailText(lang,thai);
 const [data,setData]=useState<Detail|null>(null);
 const [busy,setBusy]=useState(false),[editing,setEditing]=useState(false);
 const [archiveConfirm,setArchiveConfirm]=useState(false);
 const [archiveError,setArchiveError]=useState("");
 const archiveTrigger=useRef<HTMLButtonElement>(null);
 const archiveCancel=useRef<HTMLButtonElement>(null);
 const archiveDialog=useRef<HTMLDivElement>(null);
 const [error,setError]=useState(""),[name,setName]=useState(""),[phone,setPhone]=useState("");
 const [age,setAge]=useState(""),[notes,setNotes]=useState(""),[previous,setPrevious]=useState("");
 useEffect(()=>{
  let live=true;setData(null);setError("");setEditing(false);setArchiveConfirm(false);setArchiveError("");
  void (async()=>{
   try{
    const res=await fetch("/api/pos/optical/customers/manage?id="+encodeURIComponent(id),{cache:"no-store",credentials:"same-origin"});
    const body=await res.json() as {data?:Detail;error?:{message?:string}};
    if(!res.ok)throw new Error(body.error?.message??txt("ไม่สามารถอ่านรายละเอียดลูกค้า"));
    if(!live||!body.data)return;
    setData(body.data);const c=body.data.customer;
    setName(c.full_name);setPhone(c.phone??"");setAge(c.age==null?"":String(c.age));
    setNotes(c.notes??"");setPrevious(c.previous_prescription??"");
   }catch(e){if(live)setError(e instanceof Error?e.message:txt("อ่านรายละเอียดลูกค้าไม่สำเร็จ"));}
  })();
  return()=>{live=false;};
 },[id]);
 useEffect(()=>{
  if(!archiveConfirm)return;
  const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
  archiveCancel.current?.focus();
  const onKey=(event:KeyboardEvent)=>{
   if(event.key==="Escape"){
    event.preventDefault();event.stopPropagation();
    if(!busy){setArchiveConfirm(false);setArchiveError("");}
   }
   if(event.key==="Tab"){
    const controls=archiveDialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    if(!controls?.length)return;
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
   }
  };
  document.addEventListener("keydown",onKey,true);
  return()=>{document.removeEventListener("keydown",onKey,true);previous?.focus();};
 },[archiveConfirm,busy]);
 const save=async()=>{
  if(!data||busy)return;
  const a=age.trim()?Number(age):null;
  if(!name.trim()||(a!=null&&(!Number.isInteger(a)||a<0||a>130)))
    return setError(txt("กรุณาระบุชื่อและอายุที่ถูกต้อง (0–130 ปี)"));
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/pos/optical/customers/manage",{
    method:"PATCH",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({id,full_name:name,phone,age:a,notes,previous_prescription:previous})
   });
   const body=await response.json() as {error?:{message?:string}};
   if(!response.ok)throw new Error(body.error?.message??txt("บันทึกไม่สำเร็จ"));
   setEditing(false);onChanged();onClose();
  }catch(e){setError(e instanceof Error?e.message:txt("บันทึกไม่สำเร็จ"));}
  finally{setBusy(false);}
 };
 const archive=async()=>{
  if(!data||busy||!archiveConfirm||!data.canArchive)return;
  setBusy(true);setArchiveError("");
  try{
   const res=await fetch("/api/pos/optical/customers/manage",{
    method:"DELETE",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({id})
   });
   const body=await res.json() as {error?:{message?:string}};
   if(!res.ok)throw new Error(body.error?.message??txt("เก็บถาวรไม่สำเร็จ"));
   setArchiveConfirm(false);onChanged();onClose();
  }catch(e){setArchiveError(e instanceof Error?e.message:txt("เก็บถาวรไม่สำเร็จ"));}
  finally{setBusy(false);}
 };
 const input=(label:string,value:string,set:(v:string)=>void,type="text")=><label className="grid gap-1 text-sm font-semibold">
   {label}<input className="rounded-lg border border-slate-300 px-3 py-2" type={type} value={value}
     disabled={busy} onChange={e=>set(e.target.value)}/>
 </label>;
 const line=(label:string,value:unknown)=><div className="rounded-lg bg-slate-50 p-3 text-sm">
   <span className="block text-xs text-slate-500">{label}</span><strong>{value==null||value===""?"—":String(value)}</strong>
 </div>;
 return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-3"
  role="presentation" onClick={()=>{if(!busy&&!archiveConfirm)onClose();}}>
  <section role="dialog" aria-modal="true" aria-label={txt("รายละเอียดลูกค้าแว่นตา")}
   onClick={e=>e.stopPropagation()} className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
   <div className="flex items-center justify-between gap-4">
    <h3 className="text-xl font-bold text-slate-900">{txt("รายละเอียดลูกค้าแว่นตา")}</h3>
    <button type="button" className="rounded-lg border px-3 py-2" onClick={onClose} disabled={busy}>{txt("ปิด")}</button>
   </div>
   {error?<p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p>:null}
   {!data&&!error?<p className="p-4">{txt("กำลังโหลดข้อมูลลูกค้า...")}</p>:null}
   {data?<div className="mt-4 grid gap-4">
    <div className="grid gap-2 sm:grid-cols-3">
     {line(txt("รหัสลูกค้า"),data.customer.customer_code)}
     {line(txt("ชื่อ–นามสกุล"),data.customer.full_name)}
     {line(txt("โทรศัพท์"),data.customer.phone)}
     {line(txt("อายุ"),data.customer.age)}
     {line(txt("วันที่ตรวจล่าสุด"),data.customer.last_exam_date)}
     {line(txt("ผู้ตรวจ"),data.customer.examiner_name)}
    </div>
    {editing?<div className="grid gap-3 rounded-xl border border-emerald-200 p-4 sm:grid-cols-2">
     {input(txt("ชื่อ–นามสกุล"),name,setName)}
     {input(txt("โทรศัพท์"),phone,setPhone)}
     {input(txt("อายุ (ปี)"),age,setAge,"number")}
     {input(txt("ค่าสายตาเดิม (ข้อความ)"),previous,setPrevious)}
     <label className="grid gap-1 text-sm font-semibold sm:col-span-2">{txt("หมายเหตุ")}
       <textarea className="rounded-lg border p-3" value={notes} maxLength={1500}
         onChange={e=>setNotes(e.target.value)}/>
     </label>
     <p className="text-xs text-slate-500 sm:col-span-2">{txt("แก้ไขเฉพาะข้อมูลลูกค้า ผลตรวจเก่าจะไม่ถูกเขียนทับ")}</p>
    </div>:null}
    <div className="flex flex-wrap gap-2">
     {editing?<button type="button" disabled={busy} onClick={()=>void save()}
       className="rounded-lg bg-emerald-700 px-4 py-2 font-bold text-white">{txt("บันทึกการแก้ไข")}</button>:
       <button type="button" onClick={()=>setEditing(true)}
       className="rounded-lg border border-blue-300 px-4 py-2 text-blue-800">{txt("แก้ไขข้อมูลลูกค้า")}</button>}
     {editing?<button type="button" onClick={()=>setEditing(false)}
       className="rounded-lg border px-4 py-2">{txt("ยกเลิกแก้ไข")}</button>:null}
     {data.canArchive?<button ref={archiveTrigger} type="button" disabled={busy} onClick={()=>{setArchiveError("");setArchiveConfirm(true);}}
       className="rounded-lg border border-rose-300 bg-white px-4 py-2 text-rose-800 hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-500">{txt("ลบ (เก็บถาวร)")}</button>:null}
    </div>
    <div className="rounded-xl border border-slate-200 p-3">
     <h4 className="mb-3 font-bold">{txt("ประวัติตรวจสายตา")} ({data.exams.length} {txt("รายการ")})</h4>
     {data.exams.length===0?<p className="text-sm text-slate-500">{txt("ยังไม่มีผลตรวจ")}</p>:
      <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-xs">
       <thead><tr className="bg-emerald-50">{[txt("วันที่"),"R: SPH/CYL/AX/ADD","L: SPH/CYL/AX/ADD","PD",txt("ผู้ตรวจ")].map(x=><th key={x} className="p-2">{x}</th>)}</tr></thead>
       <tbody>{data.exams.map(e=><tr key={e.id} className="border-t">
         <td className="p-2">{opticalDetailDate(lang,e.examined_at)}</td>
         <td className="p-2">{[e.right_sph,e.right_cyl,e.right_axis,e.right_add].map(x=>x??"—").join(" / ")}</td>
         <td className="p-2">{[e.left_sph,e.left_cyl,e.left_axis,e.left_add].map(x=>x??"—").join(" / ")}</td>
         <td className="p-2">{e.pd_mm??"—"}</td><td className="p-2">{e.examiner_name??"—"}</td>
       </tr>)}</tbody>
      </table></div>}
    </div>
   </div>:null}
  </section>
  {archiveConfirm&&data?.canArchive?<div className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-slate-950/65 p-4"
   onClick={e=>{e.stopPropagation();if(!busy){setArchiveConfirm(false);setArchiveError("");}}}>
   <div ref={archiveDialog} role="alertdialog" aria-modal="true" aria-labelledby="optical-archive-title"
    aria-describedby="optical-archive-description" onClick={e=>e.stopPropagation()}
    className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-800 shadow-2xl">
    <div className="px-5 pb-5 pt-6 sm:px-6">
     <div aria-hidden="true" className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-700">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
       <path d="M12 9v4m0 4h.01M10.2 4.4 2.5 17.8A2 2 0 0 0 4.2 21h15.6a2 2 0 0 0 1.7-3.2L13.8 4.4a2 2 0 0 0-3.6 0Z"/>
      </svg>
     </div>
     <h3 id="optical-archive-title" className="mt-4 text-center text-lg font-extrabold text-slate-900">
      {txt("ยืนยันการเก็บประวัติลูกค้า")}
     </h3>
     <p className="mt-2 text-center text-sm font-semibold text-slate-700">
      {data.customer.full_name} · {data.customer.customer_code}
     </p>
     <p id="optical-archive-description" className="mt-3 text-center text-sm leading-6 text-slate-600">
      {txt("ต้องการเก็บประวัติลูกค้ารายนี้ใช่หรือไม่? หลังยืนยัน ลูกค้าจะไม่แสดงในรายการที่ใช้งานอยู่")}
     </p>
     <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
      <p className="font-bold">{txt("ข้อมูลจะไม่ถูกลบถาวร")}</p>
      <p>{txt("ข้อมูลลูกค้าและประวัติการตรวจสายตาจะถูกเก็บไว้ในระบบ การเก็บถาวรอาจถูกปฏิเสธหากยังมีใบสั่งงานที่ใช้งานอยู่")}</p>
     </div>
     {archiveError?<p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{archiveError}</p>:null}
    </div>
    <div className="grid grid-cols-2 gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
     <button ref={archiveCancel} type="button" disabled={busy}
      onClick={()=>{setArchiveConfirm(false);setArchiveError("");}}
      className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:opacity-50">
      {txt("ยกเลิก")}
     </button>
     <button type="button" disabled={busy} onClick={()=>void archive()}
      className="min-h-11 rounded-xl bg-rose-600 px-3 py-2.5 text-sm font-bold text-white hover:bg-rose-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600 disabled:opacity-50">
      {busy?txt("กำลังเก็บถาวร..."):txt("ยืนยันเก็บถาวร")}
     </button>
    </div>
   </div>
  </div>:null}
 </div>;
}
