"use client";

import { useEffect, useRef, useState } from "react";
import { RecyclingReceiptDialog } from "@/components/pos/recycling-receipt-dialog";
import { RecyclingVoidTransaction } from "@/components/pos/recycling-void-transaction";

type Mode="receipt"|"edit"|"void";
function bangkokDocumentDate(iso:string){
 const parts=new Intl.DateTimeFormat("en-CA",{
   timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"
 }).formatToParts(new Date(iso));
 const pick=(type:string)=>parts.find(part=>part.type===type)?.value??"";
 return [pick("year"),pick("month"),pick("day")].join("-");
}
export function RecyclingSalesListRowActions({
  receiptId,receiptNo,createdAt,direction,settlement,status,amountMinor,canManage,voidEnabled
}:{
  receiptId:string;receiptNo:string;createdAt:string;
  direction:"buy"|"sell";
  settlement:"cash"|"bank_transfer"|"credit";
  status:"posted"|"voided";
  amountMinor:number;
  canManage:boolean;voidEnabled:boolean;
}){
  const [mode,setMode]=useState<Mode|null>(null);
  const [returnFocus,setReturnFocus]=useState<Mode>("receipt");
  const [requestedDate,setRequestedDate]=useState("");
  const [requestReason,setRequestReason]=useState("");
  const [requestBusy,setRequestBusy]=useState(false);
  const [requestError,setRequestError]=useState("");
  const [requestSuccess,setRequestSuccess]=useState("");
  const correctionRequestId=useRef("");
  const receiptRef=useRef<HTMLButtonElement>(null);
  const editRef=useRef<HTMLButtonElement>(null);
  const voidRef=useRef<HTMLButtonElement>(null);
  const closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(mode==="edit"||mode==="void")window.requestAnimationFrame(()=>closeRef.current?.focus());
  },[mode]);
  function show(next:Mode){
    if(next==="edit"){
      setRequestedDate(bangkokDocumentDate(createdAt));
      setRequestReason("");
      setRequestError("");
      setRequestSuccess("");
      correctionRequestId.current="";
    }
    setReturnFocus(next);
    setMode(next);
  }
  async function submitCorrectionRequest(){
    if(!canManage||status!=="posted"||requestBusy||requestSuccess)return;
    if(requestReason.trim().length<10||requestReason.trim().length>500){
      setRequestError("กรุณาระบุเหตุผลการแก้วันที่อย่างน้อย 10 ตัวอักษร");
      return;
    }
    if(!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)){
      setRequestError("กรุณาเลือกวันที่ที่ต้องการให้ฝ่ายบัญชีตรวจสอบ");
      return;
    }
    if(!correctionRequestId.current)correctionRequestId.current=crypto.randomUUID();
    setRequestBusy(true);setRequestError("");
    try{
      const response=await fetch("/api/pos/recycling/transactions/"+encodeURIComponent(receiptId)+"/date-correction-request",{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({request_id:correctionRequestId.current,
          requested_date:requestedDate,reason:requestReason.trim()})
      });
      const result=await response.json().catch(()=>null) as {
        data?:{accepted?:boolean;applied?:boolean;request_id?:string};
        error?:{message?:string}
      }|null;
      if(!response.ok||result?.data?.accepted!==true){
        setRequestError(result?.error?.message??"บันทึกคำขอไม่สำเร็จ ต้นฉบับยังไม่เปลี่ยน");
        return;
      }
      setRequestSuccess("บันทึกคำขอแก้วันที่แล้ว รอฝ่ายบัญชีตรวจสอบและอนุมัติ ต้นฉบับ สต๊อก และบัญชียังไม่เปลี่ยน");
    }catch{setRequestError("ไม่สามารถยืนยันคำขอได้ โปรดตรวจสอบก่อนส่งซ้ำ");}
    finally{setRequestBusy(false);}
  }
  function close(){
    setMode(null);
    window.requestAnimationFrame(()=>{
      if(returnFocus==="edit")editRef.current?.focus();
      else if(returnFocus==="void")voidRef.current?.focus();
      else receiptRef.current?.focus();
    });
  }
  return <>
    <div className="flex flex-wrap items-center gap-1.5" data-testid="recycling-sales-list-row-actions">
      <button type="button" ref={receiptRef} onClick={()=>show("receipt")}
        className="min-h-9 whitespace-nowrap rounded-md border border-blue-200 bg-white px-2.5 text-xs font-bold text-blue-700 hover:bg-blue-50">
        ดู / พิมพ์
      </button>
      {canManage&&<button type="button" ref={editRef} disabled={status!=="posted"}
        onClick={()=>show("edit")}
        className="min-h-9 whitespace-nowrap rounded-md border border-amber-200 bg-white px-2.5 text-xs font-bold text-amber-900 disabled:opacity-40">
        แก้ไขบิล
      </button>}
      {canManage&&<button type="button" ref={voidRef} disabled={status!=="posted"}
        onClick={()=>show("void")}
        className="min-h-9 whitespace-nowrap rounded-md border border-rose-200 bg-white px-2.5 text-xs font-bold text-rose-800 disabled:opacity-40">
        ยกเลิก (VOID)
      </button>}
    </div>
    <RecyclingReceiptDialog transactionId={receiptId} receiptNo={receiptNo}
      open={mode==="receipt"} onClose={close}/>
    {(mode==="edit"||mode==="void")&&<div role="presentation"
      className="fixed inset-0 z-[1760] flex items-center justify-center bg-slate-950/70 p-3 sm:p-5">
      <section role="dialog" aria-modal="true" aria-labelledby="recycling-document-action-title"
        data-testid="recycling-document-action-modal"
        onKeyDown={event=>{
          if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close();}
        }}
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 p-4">
          <div className="min-w-0">
            <h2 id="recycling-document-action-title" className="text-base font-extrabold text-slate-900">
              {mode==="edit"?"ขอแก้ไขบิลรับซื้อ–ขายออก":"ขอยกเลิกเอกสาร (VOID)"}
            </h2>
            <p className="mt-1 break-all text-xs text-slate-600">
              {receiptNo} · {direction==="buy"?"รับซื้อเข้าร้าน":"ขายออก"} ·
              { (amountMinor/100).toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2}) } บาท
            </p>
          </div>
          <button type="button" ref={closeRef} onClick={close}
            className="min-h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700">
            ปิด (Esc)
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto p-4">
          {mode==="edit"?<section className="space-y-3" data-testid="recycling-safe-bill-correction">
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-900">
              บิลที่บันทึกแล้วเป็นหลักฐานรับซื้อ–ขายออกและตัดสต๊อก/กระทบเงินสดแล้ว
              ระบบจึงไม่อนุญาตให้แก้ยอดเงิน น้ำหนัก ราคาหรือคู่ค้าในเอกสารเดิมโดยตรง
              เพื่อไม่ให้สต๊อกและบัญชีคลาดเคลื่อน
            </p>
            <p className="text-sm leading-6 text-slate-700">
              สามารถยื่นคำขอแก้วันที่เพื่อให้ฝ่ายบัญชีตรวจสอบได้ โดยยังคงวันที่บันทึกจริง
              และหลักฐานต้นฉบับไว้ครบถ้วน ไม่เปลี่ยนวันที่บัญชีย้อนหลังโดยอัตโนมัติ
            </p>
            <form onSubmit={event=>{event.preventDefault();void submitCorrectionRequest();}}
              className="rounded-lg border border-blue-200 bg-blue-50/40 p-4" data-testid="recycling-document-date-correction-request">
              <h3 className="mb-2 text-sm font-extrabold text-blue-950">ขอแก้ไขวันที่เอกสาร (รอฝ่ายบัญชีอนุมัติ)</h3>
              <p className="mb-3 text-xs text-slate-600">วันที่บันทึกจริง: {new Date(createdAt).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</p>
              <label className="block text-sm font-semibold text-slate-800" htmlFor={"recycling-date-correction-"+receiptId}>วันที่ที่ต้องการแก้ไข</label>
              <input id={"recycling-date-correction-"+receiptId} type="date" required
                value={requestedDate} max={bangkokDocumentDate(new Date().toISOString())}
                onChange={event=>{setRequestedDate(event.target.value);setRequestError("");}}
                disabled={requestBusy||Boolean(requestSuccess)}
                className="mt-1 min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900"/>
              <label htmlFor={"recycling-date-reason-"+receiptId}
                className="mt-3 block text-sm font-semibold text-slate-800">เหตุผล (อย่างน้อย 10 ตัวอักษร)</label>
              <textarea id={"recycling-date-reason-"+receiptId} required minLength={10} maxLength={500}
                rows={3} value={requestReason}
                onChange={event=>{setRequestReason(event.target.value);setRequestError("");}}
                disabled={requestBusy||Boolean(requestSuccess)}
                placeholder="ระบุวันที่ถูกต้องและเหตุผลพร้อมหลักฐานประกอบการพิจารณา"
                className="mt-1 w-full rounded-md border border-slate-300 bg-white p-3 text-sm text-slate-900"/>
              {requestError&&<p role="alert" className="mt-2 text-xs font-semibold text-rose-700">{requestError}</p>}
              {requestSuccess&&<p role="status" className="mt-2 text-xs font-semibold text-emerald-800">{requestSuccess}</p>}
              <button type="submit" disabled={requestBusy||Boolean(requestSuccess)}
                className="mt-3 min-h-10 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white disabled:opacity-50">
                {requestBusy?"กำลังบันทึกคำขอ...":"ส่งคำขอให้ฝ่ายบัญชี"}
              </button>
            </form>
            <p className="text-sm leading-6 text-slate-700">
              หากต้องยกเลิกยอดเงินจริง ให้ผู้จัดการตรวจสต๊อกและเงินคืนจริง
              แล้วใช้คำสั่ง VOID ตามสิทธิ์ (ไม่ลบบิลต้นฉบับถาวร) จากนั้นจึงออกบิลใหม่
            </p>
            {voidEnabled? <button type="button" onClick={()=>setMode("void")}
              className="min-h-11 rounded-lg bg-rose-700 px-4 text-sm font-bold text-white">
              เปิดขั้นตอนขอยกเลิกเพื่อออกบิลใหม่
            </button>:<p role="alert" className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-800">
              ระบบยังปิดการกลับรายการเงินจริง (VOID) จนกว่าจะผ่านการตรวจรับบัญชีและสต๊อก
              กรุณาให้ฝ่ายบัญชีจัดทำเอกสารปรับปรุงตามหลักฐาน
            </p>}
          </section>:<RecyclingVoidTransaction transactionId={receiptId}
            direction={direction} settlement={settlement}
            enabled={voidEnabled} startExpanded={true}/>}
        </div>
      </section>
    </div>}
  </>;
}
