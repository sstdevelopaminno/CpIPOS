"use client";

import { useRef, useState, type FormEvent } from "react";

type Fields = {
  customer_code: string;
  full_name: string;
  phone: string;
  age: string;
  exam_date: string;
  previous_prescription: string;
  pd_mm: string;
  examiner_name: string;
  right_sph: string;
  right_cyl: string;
  right_axis: string;
  right_add: string;
  left_sph: string;
  left_cyl: string;
  left_axis: string;
  left_add: string;
  notes: string;
};
const initial = (): Fields => ({
  customer_code: "", full_name: "", phone: "", age: "",
  exam_date: new Date().toLocaleDateString("en-CA"), previous_prescription: "",
  pd_mm: "", examiner_name: "",
  right_sph: "", right_cyl: "", right_axis: "", right_add: "",
  left_sph: "", left_cyl: "", left_axis: "", left_add: "", notes: ""
});
const numeric = (v: string) => v.trim() === "" ? null : Number(v);

export function PosOpticalCustomerModal({open,onClose}:{open:boolean;onClose:()=>void}) {
  const [fields,setFields] = useState<Fields>(initial);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [success,setSuccess] = useState("");
  const requestRef = useRef<string>(crypto.randomUUID());

  if (!open) return null;
  const update=(key:keyof Fields,value:string)=>{
    setFields(current=>({...current,[key]:value}));
    setError("");setSuccess("");
    requestRef.current=crypto.randomUUID();
  };
  const input=(key:keyof Fields,label:string,opts:{type?:string;placeholder?:string;required?:boolean}={})=>(
    <label key={key} className="flex min-w-0 flex-col gap-1 text-xs font-bold text-slate-700">
      <span>{label}</span>
      <input
        className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
        type={opts.type??"text"} placeholder={opts.placeholder}
        value={fields[key]} required={opts.required}
        onChange={e=>update(key,e.target.value)}
        disabled={busy}
      />
    </label>
  );
  const submit=async(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();
    if(busy)return;
    const age=numeric(fields.age),pd=numeric(fields.pd_mm);
    if((age!==null && (age<0||age>130))||(pd!==null && (pd<30||pd>90))){
      setError("กรุณาตรวจสอบอายุ (0–130) และ PD (30–90 มม.)");return;
    }
    setBusy(true);setError("");setSuccess("");
    try{
      const keys: Array<keyof Fields>=["age","pd_mm","right_sph","right_cyl","right_axis","right_add","left_sph","left_cyl","left_axis","left_add"];
      const payload:Record<string,unknown>={...fields,request_id:requestRef.current};
      keys.forEach(key=>{payload[key]=numeric(fields[key]);});
      const response=await fetch("/api/pos/optical/customers",{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payload)
      });
      const body=await response.json().catch(()=>null) as {error?:{message?:string};data?:{record?:unknown}}|null;
      if(!response.ok)throw new Error(body?.error?.message||"บันทึกข้อมูลลูกค้าไม่สำเร็จ");
      setSuccess("บันทึกข้อมูลลูกค้าและผลตรวจสายตาแล้ว");
      requestRef.current=crypto.randomUUID();
    }catch(e){setError(e instanceof Error?e.message:"ไม่สามารถบันทึกได้");}
    finally{setBusy(false);}
  };
  return (
    <div className="posui-payment-modal-backdrop z-[90]" role="presentation" onClick={()=>{if(!busy)onClose();}}>
      <section className="posui-payment-modal max-h-[92vh] !w-[min(920px,96vw)] overflow-y-auto" role="dialog" aria-modal="true" aria-label="เพิ่มประวัติลูกค้า IMDC OPTICAL" onClick={e=>e.stopPropagation()}>
        <header className="posui-payment-modal__header">
          <h3>เพิ่มประวัติลูกค้า · IMDC OPTICAL</h3>
          <button type="button" className="posui-btn" onClick={onClose} disabled={busy}>ปิด</button>
        </header>
        <p className="text-xs text-slate-600">บันทึกข้อมูลเฉพาะร้านและสาขาที่เข้าสู่ระบบ ข้อมูลการตรวจครั้งก่อนจะยังคงอยู่ในประวัติ</p>
        <form onSubmit={event=>void submit(event)} className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {input("customer_code","รหัสลูกค้า",{required:true,placeholder:"รหัสลูกค้า"})}
            {input("full_name","ชื่อ–นามสกุล",{required:true})}
            {input("phone","เบอร์โทรศัพท์",{type:"tel"})}
            {input("age","อายุ (ปี)",{type:"number"})}
            {input("exam_date","วันที่ตรวจล่าสุด",{type:"date",required:true})}
            {input("examiner_name","พนักงานตรวจ / ผู้ตรวจ")}
          </div>
          <fieldset className="grid gap-3 rounded-xl border border-slate-200 p-3">
            <legend className="px-2 text-sm font-bold text-emerald-900">ค่าสายตา R / L</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {input("right_sph","R — SPH",{type:"number",placeholder:"-1.25"})}
              {input("right_cyl","R — CYL",{type:"number",placeholder:"-0.50"})}
              {input("right_axis","R — AX (0–180)",{type:"number"})}
              {input("right_add","R — ADD",{type:"number"})}
              {input("left_sph","L — SPH",{type:"number"})}
              {input("left_cyl","L — CYL",{type:"number"})}
              {input("left_axis","L — AX (0–180)",{type:"number"})}
              {input("left_add","L — ADD",{type:"number"})}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {input("pd_mm","PD (มม.)",{type:"number",placeholder:"62"})}
              {input("previous_prescription","ค่าสายตาเดิม")}
            </div>
          </fieldset>
          <label className="grid gap-1 text-xs font-semibold text-slate-700">หมายเหตุ
            <textarea value={fields.notes} disabled={busy} onChange={e=>update("notes",e.target.value)} rows={2} className="rounded-lg border border-slate-300 p-3 text-sm" />
          </label>
          {error?<p role="alert" className="text-sm font-bold text-rose-700">{error}</p>:null}
          {success?<p role="status" className="text-sm font-bold text-emerald-700">{success}</p>:null}
          <div className="flex items-center justify-end gap-3">
            <button type="button" className="posui-btn" onClick={onClose} disabled={busy}>ปิด</button>
            <button type="submit" className="posui-btn posui-btn--primary" disabled={busy}>
              {busy?"กำลังบันทึก...":"บันทึกประวัติลูกค้า"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
