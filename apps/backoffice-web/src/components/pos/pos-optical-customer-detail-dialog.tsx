"use client";
import {useEffect,useState} from "react";
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
 const [error,setError]=useState(""),[name,setName]=useState(""),[phone,setPhone]=useState("");
 const [age,setAge]=useState(""),[notes,setNotes]=useState(""),[previous,setPrevious]=useState("");
 useEffect(()=>{
  let live=true;setData(null);setError("");setEditing(false);
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
  if(!data||busy||!window.confirm(txt("ย้ายลูกค้าเข้าประวัติเก็บถาวร? ข้อมูลผลตรวจจะไม่ถูกลบ")))return;
  setBusy(true);setError("");
  try{
   const res=await fetch("/api/pos/optical/customers/manage",{
    method:"DELETE",headers:{"Content-Type":"application/json"},credentials:"same-origin",body:JSON.stringify({id})
   });
   const body=await res.json() as {error?:{message?:string}};
   if(!res.ok)throw new Error(body.error?.message??txt("เก็บถาวรไม่สำเร็จ"));
   onChanged();onClose();
  }catch(e){setError(e instanceof Error?e.message:txt("เก็บถาวรไม่สำเร็จ"));}
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
  role="presentation" onClick={()=>{if(!busy)onClose();}}>
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
     {data.canArchive?<button type="button" disabled={busy} onClick={()=>void archive()}
       className="rounded-lg border border-rose-300 px-4 py-2 text-rose-800">{txt("ลบ (เก็บถาวร)")}</button>:null}
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
 </div>;
}
