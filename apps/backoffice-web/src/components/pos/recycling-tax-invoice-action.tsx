"use client";

import { useEffect, useRef, useState } from "react";

type Paper="58"|"80"|"a4"|"a5";
type Buyer={id:string;display_name:string;tax_id:string;address_line:string;subdistrict:string;district:string;province:string;postal_code:string};
type Invoice={id:string;invoice_no:string;profile_id:string;issued_at:string};
type Seller={display_name?:string;tax_id?:string;address?:string;branch_no?:string};
type Sale={
 id:string;receipt_no:string;status:string;tax_state:string|null;
 base_minor:number|null;vat_minor:number|null;total_minor:number;
 tax_snapshot?:{seller?:Seller};
};
type Document={transaction:Sale;invoice:Invoice|null;eligible:boolean;issuing_enabled:boolean;seller_verified:boolean};
type Api<T>={data?:T;error?:{message?:string;code?:string}};

function money(minor:number|undefined|null){
  return Number((minor??0)/100).toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2});
}

/** Real tax invoices are independent of the non-tax Recycling receipt popup.
 * Only the server's verified invoice RPC may issue; this component never
 * calculates an invoice, invents a number, or repeats a posted sale.
 */
export function RecyclingTaxInvoiceAction({
  transactionId,receiptNo
}:{
  transactionId:string;receiptNo:string;
}){
 const [open,setOpen]=useState(false);
 const [loading,setLoading]=useState(false);
 const [issuing,setIssuing]=useState(false);
 const [detail,setDetail]=useState<Document|null>(null);
 const [buyers,setBuyers]=useState<Buyer[]>([]);
 const [buyerId,setBuyerId]=useState("");
 const [buyerBranchNo,setBuyerBranchNo]=useState("");
 const [pin,setPin]=useState("");
 const [paper,setPaper]=useState<Paper>("a4");
 const [paperReady,setPaperReady]=useState(false);
 const [error,setError]=useState("");
 const frame=useRef<HTMLIFrameElement>(null);
 const close=useRef<HTMLButtonElement>(null);

 useEffect(()=>{if(open)window.requestAnimationFrame(()=>close.current?.focus());},[open]);
 useEffect(()=>{setPaperReady(false);},[paper,detail?.invoice?.id]);

 async function refresh(){
   setLoading(true);setError("");
   try{
     const [source,profiles]=await Promise.all([
       fetch("/api/pos/recycling/tax-invoices?transaction_id="+encodeURIComponent(transactionId),
         {credentials:"same-origin",cache:"no-store"}),
       fetch("/api/pos/tax-invoices?mode=profiles",{credentials:"same-origin",cache:"no-store"})
     ]);
     const src=await source.json().catch(()=>null) as Api<Document>|null;
     const prof=await profiles.json().catch(()=>null) as Api<{profiles?:Buyer[]}>|null;
     if(!source.ok||!src?.data)throw Error(src?.error?.message??"ไม่สามารถอ่านรายการขายออก");
     if(!profiles.ok||!prof?.data)throw Error(prof?.error?.message??"อ่านทะเบียนผู้ซื้อไม่สำเร็จ");
     setDetail(src.data);
     const choices=Array.isArray(prof.data.profiles)?prof.data.profiles:[];
     setBuyers(choices);
     setBuyerId(id=>id||choices[0]?.id||"");
   }catch(caught){
     setError(caught instanceof Error?caught.message:"ไม่สามารถโหลดข้อมูลภาษี");
   }finally{setLoading(false);}
 }
 function openDialog(){
   setOpen(true);setError("");setDetail(null);setPaper("a4");
   setPin("");setBuyerId("");setBuyerBranchNo("");void refresh();
 }
 async function issue(){
   if(issuing||!detail?.eligible||!detail.issuing_enabled||!detail.seller_verified||!buyerId||pin.length<4||!/^[0-9]{5}$/.test(buyerBranchNo))return;
   setIssuing(true);setError("");
   try{
     const response=await fetch("/api/pos/recycling/tax-invoices",{
       method:"POST",credentials:"same-origin",
       headers:{"Content-Type":"application/json"},
       body:JSON.stringify({transaction_id:transactionId,profile_id:buyerId,
         buyer_branch_no:buyerBranchNo,manager_pin:pin})
     });
     const result=await response.json().catch(()=>null) as Api<{invoice?:Invoice}>|null;
     if(!response.ok||!result?.data?.invoice?.id)
       throw Error(result?.error?.message??"ไม่สามารถออกใบกำกับภาษี");
     setPin("");await refresh();
   }catch(caught){
     setError(caught instanceof Error?caught.message:"ออกใบกำกับภาษีไม่สำเร็จ");
   }finally{setIssuing(false);}
 }
 function print(){
   if(!paperReady||!frame.current?.contentWindow){
     setError("เอกสารยังไม่พร้อมพิมพ์ กรุณาตรวจสอบการแสดงผล");return;
   }
   try{
     frame.current.contentWindow.focus();
     frame.current.contentWindow.print(); // Explicit print dialog; no false confirmation.
   }catch{setError("ไม่สามารถเปิดหน้าต่างพิมพ์ กรุณาตรวจสอบเครื่องและเบราว์เซอร์");}
 }
 return <>
  <button type="button" onClick={openDialog}
    data-testid="recycling-tax-invoice-open"
    className="inline-flex min-h-9 items-center rounded-md border border-blue-300 bg-blue-50 px-3 text-xs font-bold text-blue-800 hover:bg-blue-100">
    ใบกำกับภาษี / พิมพ์
  </button>
  {open&&<div role="presentation" className="fixed inset-0 z-[1800] flex items-center justify-center bg-slate-950/70 p-2 sm:p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="recycling-tax-invoice-title"
      onKeyDown={event=>{if(event.key==="Escape"&&!issuing){event.stopPropagation();setOpen(false);}}}
      className="flex max-h-[94dvh] w-full max-w-5xl min-w-0 flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div><h2 id="recycling-tax-invoice-title" className="text-lg font-extrabold">ออกใบกำกับภาษี Recycling</h2>
          <p className="text-xs text-slate-500">อ้างอิงเลขบิล {receiptNo} · ใช้ข้อมูล VAT ที่บันทึกแล้วเท่านั้น</p></div>
        <button ref={close} type="button" disabled={issuing} onClick={()=>setOpen(false)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-bold">ปิด</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading&&<p role="status" className="text-sm text-blue-700">กำลังโหลดเอกสารและทะเบียนผู้ซื้อ...</p>}
        {error&&<p role="alert" className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-800">{error}</p>}
        {detail&&<div className="space-y-3">
          <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm sm:grid-cols-3">
            <span>ฐานก่อน VAT: <b>{money(detail.transaction.base_minor)} บาท</b></span>
            <span>VAT บันทึก: <b>{money(detail.transaction.vat_minor)} บาท</b></span>
            <span>รวมรับชำระ: <b>{money(detail.transaction.total_minor)} บาท</b></span>
          </div>
          {detail.transaction.tax_snapshot?.seller&&<div className="rounded-md border border-slate-200 p-3 text-xs">
            <strong>ข้อมูลผู้ออกใบกำกับภาษีที่บันทึกพร้อมบิล</strong>
            <p className="mt-1">{detail.transaction.tax_snapshot.seller.display_name} · เลขภาษี {detail.transaction.tax_snapshot.seller.tax_id}</p>
            <p>{detail.transaction.tax_snapshot.seller.address} · สาขา {detail.transaction.tax_snapshot.seller.branch_no}</p>
          </div>}
          {detail.invoice?<div className="space-y-3">
            <p role="status" className="text-sm font-bold text-emerald-800">
              ออกใบกำกับภาษีเลขที่ {detail.invoice.invoice_no} แล้ว · การพิมพ์ซ้ำไม่ออกใบใหม่
            </p>
            <div role="group" aria-label="เลือกขนาดใบกำกับภาษี" className="flex flex-wrap gap-2">
              {([["58","58 มม."],["80","80 มม."],["a4","A4"],["a5","A5"]] as const).map(([value,label])=>
                <button key={value} type="button" onClick={()=>setPaper(value)}
                  aria-pressed={paper===value}
                  className={"rounded-md border px-4 py-2 text-sm font-bold "+
                    (paper===value?"border-blue-700 bg-blue-700 text-white":"border-slate-300 bg-white")}>
                  {label}
                </button>)}
            </div>
            <iframe ref={frame}
              key={detail.invoice.id+"-"+paper}
              src={"/api/pos/recycling/tax-invoices/"+encodeURIComponent(detail.invoice.id)+"/preview?paper="+paper}
              title="ตัวอย่างใบกำกับภาษีที่ออกแล้ว"
              onLoad={()=>setPaperReady(true)}
              className="h-[min(52dvh,620px)] w-full rounded-md border border-slate-300 bg-white"/>
            <button type="button" onClick={print} disabled={!paperReady}
              data-testid="recycling-tax-invoice-print"
              className="rounded-md bg-blue-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-40">
              พิมพ์ใบกำกับภาษี {paper.toUpperCase()} (เลือกเครื่องพิมพ์)
            </button>
          </div>:<div className="space-y-3">
            {!detail.eligible&&<p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              บิลนี้ยังไม่มี VAT ที่บันทึกจริง หรือไม่ใช่บิลขายออกที่พร้อมออกใบกำกับภาษี ไม่สามารถสร้างภาษีย้อนหลังจากการตั้งค่าปัจจุบัน
            </p>}
            {!detail.issuing_enabled&&<p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              ฟังก์ชันออกใบกำกับภาษียังไม่เปิด Production ต้องผ่านการทดสอบฐานข้อมูลและบัญชี
            </p>}
            {!detail.seller_verified&&<p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              ยังไม่ได้ยืนยันทะเบียน VAT ของร้านพร้อมหลักฐานอย่างเป็นทางการ
            </p>}
            <label className="block text-sm font-bold">ผู้ซื้อ / ผู้รับใบกำกับภาษี
              <select value={buyerId} onChange={e=>setBuyerId(e.target.value)}
                className="mt-1 block h-11 w-full rounded-md border border-slate-300 bg-white px-3">
                <option value="">เลือกทะเบียนผู้ซื้อ</option>
                {buyers.map(b=><option key={b.id} value={b.id}>{b.display_name} · {b.tax_id}</option>)}
              </select>
            </label>
            {buyers.length===0&&<p className="text-xs text-amber-800">
              ยังไม่มีทะเบียนผู้ซื้อ กรุณากลับไปเมนู “ทะเบียนผู้ซื้อ / ข้อมูลผู้ออกเอกสาร” เพื่อเพิ่มชื่อ ที่อยู่ และเลขผู้เสียภาษี
            </p>}
            <label className="block text-sm font-bold">เลขสาขาของผู้ซื้อ (5 หลัก)
              <input type="text" inputMode="numeric" value={buyerBranchNo}
                onChange={e=>setBuyerBranchNo(e.target.value.replace(/[^0-9]/g,"").slice(0,5))}
                maxLength={5} placeholder="กรอกตามข้อมูลผู้ซื้อ เช่น 00000 สำหรับสำนักงานใหญ่"
                className="mt-1 block h-11 w-full rounded-md border border-slate-300 px-3"/>
            </label>
            <label className="block text-sm font-bold">PIN Owner / Manager
              <input type="password" inputMode="numeric" value={pin}
                onChange={e=>setPin(e.target.value)} maxLength={30}
                className="mt-1 block h-11 w-full rounded-md border border-slate-300 px-3"/>
            </label>
            <button type="button" onClick={()=>void issue()}
              disabled={issuing||!detail.eligible||!detail.issuing_enabled||!detail.seller_verified||!buyerId||pin.length<4||!/^[0-9]{5}$/.test(buyerBranchNo)}
              className="rounded-md bg-blue-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-40">
              {issuing?"กำลังออกเอกสาร...":"ยืนยันออกใบกำกับภาษีจากยอด VAT ที่บันทึกจริง"}
            </button>
          </div>}
        </div>}
      </div>
    </section>
  </div>}
 </>;
}
