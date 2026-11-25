"use client";
import { useCallback,useEffect,useState } from "react";
type Status={configured:boolean;verified:boolean;chart:{account_code:string;account_name:string;account_type:string}|null;can_edit:boolean};
export function RecyclingVatSetup({endpoint="/api/pos/recycling/vat/setup"}:{endpoint?:string}={}){
  const [status,setStatus]=useState<Status|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const refresh=useCallback(async()=>{
    try{
      const response=await fetch(endpoint,{credentials:"same-origin",cache:"no-store"});
      const body=await response.json();
      if(!response.ok||!body.data)throw Error(body.error?.message??"ตรวจสอบสถานะไม่สำเร็จ");
      setStatus(body.data);
    }catch(e){setStatus(null);setError(e instanceof Error?e.message:"ตรวจสอบสถานะไม่สำเร็จ");}
  },[endpoint]);
  useEffect(()=>{void refresh();},[refresh]);
  async function submit(payload:Record<string,unknown>){
    if(busy||!status?.can_edit)return;
    setBusy(true);setError("");setNotice("");
    try{
      const response=await fetch(endpoint,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const body=await response.json();
      if(!response.ok)throw Error(body.error?.message??"บันทึกไม่สำเร็จ");
      setNotice("บันทึกแล้ว กรุณาตรวจสอบสถานะก่อนกลับไปหน้าขาย");
    }catch(e){setError(e instanceof Error?e.message:"ยังไม่ยืนยันผลการบันทึก");}
    finally{await refresh();setBusy(false);}
  }
  return <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4" data-testid="recycling-vat-setup">
    <div><h2 className="text-lg font-extrabold">ตั้งค่าภาษีขาย Recycling</h2><p className="text-sm text-slate-600">ฝ่ายบัญชียืนยันทะเบียน VAT และผังบัญชีของร้าน ไม่ใช่หน้าที่ฝ่าย IT</p></div>
    <div className="grid gap-2 sm:grid-cols-3">
      <div className="rounded border p-3">VAT ของสาขา: <strong>{status?status.configured?"เปิดแล้ว":"ยังไม่เปิด":"รอตรวจสอบ"}</strong></div>
      <div className="rounded border p-3">ทะเบียน VAT: <strong>{status?status.verified?"ยืนยันแล้ว":"ยังไม่ยืนยัน":"รอตรวจสอบ"}</strong></div>
      <div className="rounded border p-3">บัญชี 2200: <strong>{status?status.chart?.account_type==="liability"?"พร้อม":status.chart?"ประเภทไม่ถูกต้อง":"ยังไม่มี":"รอตรวจสอบ"}</strong></div>
    </div>
    {error&&<p role="alert" className="rounded bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
    {notice&&<p role="status" className="rounded bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p>}
    <button type="button" disabled={busy} onClick={()=>void refresh()} className="rounded border px-3 py-2 text-sm font-bold">ตรวจสอบสถานะอีกครั้ง</button>
    {status?.can_edit&&<>
      {!status.chart&&<button type="button" disabled={busy} onClick={()=>{if(window.confirm("สร้างบัญชี 2200 ภาษีขายรอนำส่ง ประเภทหนี้สิน?"))void submit({action:"prepare_chart",confirmed:true});}} className="ml-2 rounded bg-blue-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">จัดเตรียมบัญชี 2200</button>}
      <form className="grid gap-3 border-t pt-4 sm:grid-cols-2" onSubmit={event=>{
        event.preventDefault();const fields=new FormData(event.currentTarget);
        void submit({action:"verify_registration",tax_id:fields.get("tax_id"),legal_name:fields.get("legal_name"),legal_address:fields.get("legal_address"),branch_no:fields.get("branch_no"),evidence_reference:fields.get("evidence_reference"),verified_from:fields.get("verified_from"),verified_until:fields.get("verified_until"),confirmed:fields.get("confirmed")==="on"});
      }}>
        <p className="text-sm text-slate-600 sm:col-span-2">กรอกตามเอกสารทะเบียน VAT จริงของสาขาเท่านั้น การยืนยันนี้เป็นการตรวจเอกสารโดยฝ่ายบัญชี ไม่ใช่การตรวจอัตโนมัติกับกรมสรรพากร</p>
        <label className="grid gap-1 text-sm">เลขประจำตัวผู้เสียภาษี<input name="tax_id" required pattern="[0-9]{13}" inputMode="numeric" maxLength={13} className="rounded border p-2"/></label>
        <label className="grid gap-1 text-sm">รหัสสาขา 5 หลัก<input name="branch_no" required pattern="[0-9]{5}" inputMode="numeric" maxLength={5} className="rounded border p-2"/></label>
        <label className="grid gap-1 text-sm sm:col-span-2">ชื่อจดทะเบียน<input name="legal_name" required minLength={2} maxLength={240} className="rounded border p-2"/></label>
        <label className="grid gap-1 text-sm sm:col-span-2">ที่อยู่จดทะเบียน<textarea name="legal_address" required minLength={5} maxLength={1000} className="rounded border p-2"/></label>
        <label className="grid gap-1 text-sm sm:col-span-2">เลขอ้างอิงเอกสารหลักฐาน VAT<input name="evidence_reference" required minLength={5} maxLength={500} className="rounded border p-2"/></label>
        <label className="grid gap-1 text-sm">วันที่ทะเบียนมีผล<input name="verified_from" required type="date" className="rounded border p-2"/></label>
        <label className="grid gap-1 text-sm">วันสิ้นสุด (ถ้ามี)<input name="verified_until" type="date" className="rounded border p-2"/></label>
        <label className="flex items-start gap-2 text-sm sm:col-span-2"><input required name="confirmed" type="checkbox"/>ยืนยันว่าตรวจสอบเอกสารจริงแล้ว ข้อมูลตรงกับสาขาและมีผลในปัจจุบัน</label>
        <button disabled={busy||!status.configured} type="submit" className="rounded bg-blue-700 p-3 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2">{busy?"กำลังบันทึก...":"ยืนยันทะเบียน VAT ของสาขา"}</button>
      </form>
    </>}
  </section>;
}
