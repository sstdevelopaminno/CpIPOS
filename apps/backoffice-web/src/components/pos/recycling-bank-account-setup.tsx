"use client";
import {useState} from "react";
export function RecyclingBankAccountSetup({onSaved}:{onSaved:()=>Promise<void>}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 return <div className="space-y-2">
 <button type="button" disabled={busy} onClick={()=>setOpen(v=>!v)} className="rounded border px-3 py-2 text-sm font-bold">จัดเตรียมบัญชีธนาคารของสาขา</button>
 {open&&<form className="grid gap-2 rounded border p-3 sm:grid-cols-2" onSubmit={async e=>{
  e.preventDefault();if(busy)return;setBusy(true);setError("");const f=new FormData(e.currentTarget);
  try{const response=await fetch("/api/pos/recycling/bank-transfers/accounts",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({bank_code:f.get("bank_code"),account_last4:f.get("last4"),account_label:f.get("label"),evidence_reference:f.get("evidence"),confirmed:f.get("confirmed")==="on"})});const body=await response.json();
   if(!response.ok||!body?.data?.id)throw Error(body?.error?.message??"ยังไม่ยืนยันผลบันทึก");setOpen(false);await onSaved();
  }catch(e){setError(e instanceof Error?e.message:"ไม่สามารถยืนยันผลบันทึก");}finally{setBusy(false);}
 }}>
 <p className="sm:col-span-2 text-xs text-slate-600">ฝ่ายบัญชีตรวจสอบหลักฐานความเป็นเจ้าของบัญชีจริงก่อนยืนยัน เลขท้าย 4 หลักใช้เพื่อแสดงผลเท่านั้น</p>
 <label className="grid gap-1 text-sm">รหัสธนาคาร<input required name="bank_code" minLength={2} maxLength={12} className="rounded border p-2"/></label>
 <label className="grid gap-1 text-sm">เลขท้ายบัญชี 4 หลัก<input required name="last4" pattern="[0-9]{4}" inputMode="numeric" maxLength={4} className="rounded border p-2"/></label>
 <label className="grid gap-1 text-sm">ชื่อเรียกบัญชี<input required name="label" minLength={2} maxLength={120} className="rounded border p-2"/></label>
 <label className="grid gap-1 text-sm">เลขอ้างอิงหลักฐานเจ้าของบัญชี<input required name="evidence" minLength={5} maxLength={500} className="rounded border p-2"/></label>
 <label className="flex items-start gap-2 text-sm sm:col-span-2"><input required name="confirmed" type="checkbox"/>ยืนยันว่าตรวจสอบหลักฐานจริงของสาขาแล้ว</label>
 {error&&<p role="alert" className="text-sm text-rose-800 sm:col-span-2">{error}</p>}
 <button type="submit" disabled={busy} className="rounded bg-blue-700 p-2 font-bold text-white disabled:opacity-50">บันทึกบัญชีที่ตรวจสอบแล้ว</button>
 </form>}
 </div>;
}
