"use client";

import { useEffect, useRef, useState } from "react";
import { RecyclingPrintReceiptButton } from "@/components/pos/recycling-print-receipt-button";

type Paper="auto"|"58"|"80"|"a5";

/** Shared in-app proof for a successful purchase or an existing receipt.
 * Does not make or repeat a financial transaction. The POS checkout already
 * queues its configured thermal print job once after server commit.
 */
export function RecyclingReceiptDialog({
  transactionId,receiptNo,open,onClose,autoPrintNotice,printing
}:{
  transactionId:string;
  receiptNo?:string|null;
  open:boolean;
  onClose:()=>void;
  autoPrintNotice?:{ok:boolean;message:string}|null;
  printing?:boolean;
}){
  const [paper,setPaper]=useState<Paper>("auto");
  const [a5Ready,setA5Ready]=useState(false);
  const [a5Error,setA5Error]=useState("");
  const closeRef=useRef<HTMLButtonElement>(null);
  const a5Ref=useRef<HTMLIFrameElement>(null);
  const visibleRef=useRef<HTMLIFrameElement>(null);
  useEffect(()=>{
    if(!open)return;
    setPaper("auto");
    setA5Ready(false);
    setA5Error("");
    window.requestAnimationFrame(()=>closeRef.current?.focus());
  },[open,transactionId]);
  if(!open)return null;
  const base="/api/pos/recycling/receipts/"+encodeURIComponent(transactionId)+"/preview";
  const src=(size:Paper)=>base+"?paper="+size;
  function printA5(){
    if(!a5Ready){setA5Error("เอกสาร A5 ยังไม่พร้อมพิมพ์ กรุณาลองอีกครั้ง");return;}
    const frame=paper==="a5"?visibleRef.current:a5Ref.current;
    if(!frame?.contentWindow){setA5Error("ไม่สามารถเชื่อมกับหน้าต่างพิมพ์ A5");return;}
    try{
      frame.contentWindow.focus();
      frame.contentWindow.print(); // browser/Windows print dialogue; never claims silent device printing
      setA5Error("");
    }catch{setA5Error("เครื่องพิมพ์ A4/A5 ไม่พร้อม กรุณาเลือกเครื่องในหน้าต่างพิมพ์");}
  }
  return <div role="presentation" className="fixed inset-0 z-[1750] flex items-center justify-center bg-slate-950/70 p-2 sm:p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="recycling-receipt-modal-title"
      data-testid="recycling-receipt-modal"
      onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();onClose();}}}
      className="relative flex h-[min(92dvh,960px)] w-full max-w-3xl min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="min-w-0">
          <h2 id="recycling-receipt-modal-title" className="text-base font-extrabold text-slate-900">
            ใบเสร็จรับซื้อ–ขายออกวัสดุรีไซเคิล
          </h2>
          <p className="mt-1 break-all text-xs text-slate-600">
            {receiptNo?"เลขที่ "+receiptNo:"หลักฐานต้นฉบับจากทะเบียน Recycling"} ·
            การพิมพ์ซ้ำไม่สร้างรายการซื้อขายใหม่
          </p>
        </div>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="ปิดใบเสร็จ"
          className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700">
          ปิด (Esc)
        </button>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-200 bg-white px-4 py-2"
        role="group" aria-label="ขนาดใบเสร็จ">
        {([
          ["auto","ตามเครื่องพิมพ์"],["58","58 มม."],["80","80 มม."],["a5","A5"]
        ] as const).map(([size,label])=>
          <button type="button" key={size} onClick={()=>setPaper(size)} aria-pressed={paper===size}
            className={"min-h-9 rounded-md border px-3 text-xs font-bold "+
              (paper===size?"border-blue-700 bg-blue-700 text-white":"border-slate-300 bg-white text-slate-700")}>
            {label}
          </button>)}
        <span className="ml-auto text-[11px] text-slate-500">ขนาดพรีวิวไม่เปลี่ยนค่าที่ตั้งของ Print Agent</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-slate-100 p-2 sm:p-3">
        <iframe key={src(paper)} ref={visibleRef} src={src(paper)}
          onLoad={()=>{if(paper==="a5")setA5Ready(true);}}
          title="ตัวอย่างใบเสร็จจากรายการซื้อขายจริง"
          className="h-full w-full rounded-lg border border-slate-200 bg-white"/>
      </div>
      {paper!=="a5"&&<iframe ref={a5Ref} src={src("a5")}
        onLoad={()=>setA5Ready(true)}
        title="เอกสาร A5 สำหรับพิมพ์" tabIndex={-1} aria-hidden="true"
        style={{position:"absolute",left:"-10000px",top:0,width:600,height:850}}/>}
      <footer className="shrink-0 space-y-2 border-t border-slate-200 bg-white px-4 py-3">
        {printing&&<p role="status" className="text-xs font-bold text-blue-800">กำลังส่งพิมพ์ใบเสร็จความร้อนตามเครื่องที่ตั้งค่า...</p>}
        {autoPrintNotice&&<p role={autoPrintNotice.ok?"status":"alert"}
          className={"rounded-md p-2 text-xs font-semibold "+(autoPrintNotice.ok?"bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-900")}>
          {autoPrintNotice.message}
        </p>}
        {a5Error&&<p role="alert" className="text-xs font-semibold text-rose-700">{a5Error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <RecyclingPrintReceiptButton receiptId={transactionId} showBrowserButton={false}/>
          <button type="button" disabled={!a5Ready} onClick={printA5}
            data-testid="recycling-print-a5"
            className="min-h-11 rounded-lg border border-blue-300 bg-blue-50 px-4 text-sm font-bold text-blue-900 disabled:opacity-40">
            พิมพ์เอกสาร A5 (เครื่องพิมพ์ A4/A5)
          </button>
          <button type="button" onClick={onClose}
            className="ml-auto min-h-11 rounded-lg bg-slate-800 px-5 text-sm font-bold text-white">
            ตกลง / กลับหน้าขาย
          </button>
        </div>
        <p className="text-[11px] leading-5 text-slate-500">
          ใบเสร็จความร้อนส่งเข้า Print Agent อัตโนมัติหลังบันทึกสำเร็จ (เมื่อกำหนดเครื่องพิมพ์แล้ว)
          ส่วน A5 เปิดหน้าต่างพิมพ์ของ Windows/เบราว์เซอร์เพื่อเลือกเครื่อง A4/A5 และกระดาษตามไดรเวอร์
        </p>
      </footer>
    </section>
  </div>;
}
