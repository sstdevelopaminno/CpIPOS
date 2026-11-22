"use client";

import { useEffect, useRef, useState } from "react";
import { RecyclingReceiptDialog } from "@/components/pos/recycling-receipt-dialog";
import { RecyclingVoidTransaction } from "@/components/pos/recycling-void-transaction";

type Mode="receipt"|"edit"|"void";
export function RecyclingSalesListRowActions({
  receiptId,receiptNo,direction,settlement,status,amountMinor,canManage,voidEnabled
}:{
  receiptId:string;receiptNo:string;
  direction:"buy"|"sell";
  settlement:"cash"|"bank_transfer"|"credit";
  status:"posted"|"voided";
  amountMinor:number;
  canManage:boolean;voidEnabled:boolean;
}){
  const [mode,setMode]=useState<Mode|null>(null);
  const [returnFocus,setReturnFocus]=useState<Mode>("receipt");
  const receiptRef=useRef<HTMLButtonElement>(null);
  const editRef=useRef<HTMLButtonElement>(null);
  const voidRef=useRef<HTMLButtonElement>(null);
  const closeRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(mode==="edit"||mode==="void")window.requestAnimationFrame(()=>closeRef.current?.focus());
  },[mode]);
  function show(next:Mode){
    setReturnFocus(next);
    setMode(next);
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
              วิธีแก้ไขที่ตรวจสอบย้อนหลังได้คือให้ผู้จัดการตรวจสต๊อกและเงินคืนจริง
              ยกเลิกต้นฉบับตามสิทธิ์ แล้วจึงสร้างบิลใหม่จากหน้าขาย
              โดยเลขเอกสารเดิมยังเก็บเป็น VOID
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
