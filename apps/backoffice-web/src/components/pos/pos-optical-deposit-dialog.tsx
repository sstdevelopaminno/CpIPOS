"use client";

import {useEffect,useState} from "react";
import {formatSalesMoney} from "@/lib/pos-money";
import {resolveOpticalDeposit,sanitizeOpticalDepositInput,type OpticalDepositCurrency,type OpticalDepositMethod} from "@/lib/optical-deposit-amount";

type Language="th"|"en"|"lo";
type Props={total:number;currency:OpticalDepositCurrency;language:Language;
  onClose:()=>void;onSubmit?: (amount:number,method:OpticalDepositMethod)=>Promise<void>|void};
const languages={
 th:{title:"ชำระเงินมัดจำ",hint:"กรอกจำนวนเงินที่ลูกค้าต้องการมัดจำ",total:"ยอดสินค้า",due:"ยอดมัดจำ",balance:"คงค้างหลังมัดจำ",continue:"ยืนยันจำนวนเงิน",step2:"เลือกวิธีชำระเงินมัดจำ",cash:"เงินสด",transfer:"โอนเงิน",confirm:"ยืนยันรับเงินมัดจำ",back:"ย้อนกลับ",close:"ปิด",clear:"ล้าง",del:"ลบ",error:"จำนวนเงินต้องมากกว่า 0 และไม่เกินยอดสินค้า",unavailable:"ยังไม่สามารถรับเงินจริงได้: ต้องเชื่อมบัญชีมัดจำและการตัดสต๊อก Optical กับระบบหลังบ้านก่อน",note:"เป็นเงินมัดจำ ไม่ใช่การขายเต็มจำนวน"},
 en:{title:"Deposit payment",hint:"Enter the customer's deposit amount",total:"Order total",due:"Deposit",balance:"Remaining balance",continue:"Confirm amount",step2:"Deposit payment method",cash:"Cash",transfer:"Bank transfer",confirm:"Confirm deposit payment",back:"Back",close:"Close",clear:"Clear",del:"Delete",error:"Enter an amount greater than zero and no more than the order total",unavailable:"Payment not available: Optical deposit ledger and stock workflow must be connected first",note:"This is a deposit, not payment for the full order"},
 lo:{title:"ຊຳລະເງິນມັດຈຳ",hint:"ປ້ອນຈຳນວນເງິນມັດຈຳຂອງລູກຄ້າ",total:"ຍອດສິນຄ້າ",due:"ຍອດມັດຈຳ",balance:"ຍອດຄ້າງຫຼັງມັດຈຳ",continue:"ຢືນຢັນຈຳນວນ",step2:"ເລືອກວິທີຊຳລະເງິນມັດຈຳ",cash:"ເງິນສົດ",transfer:"ໂອນເງິນ",confirm:"ຢືນຢັນຮັບເງິນມັດຈຳ",back:"ກັບຄືນ",close:"ປິດ",clear:"ລ້າງ",del:"ລົບ",error:"ຈຳນວນເງິນຕ້ອງຫຼາຍກວ່າ 0 ແລະ ບໍ່ເກີນຍອດສິນຄ້າ",unavailable:"ຍັງຮັບເງິນຈິງບໍ່ໄດ້: ຕ້ອງເຊື່ອມບັນຊີມັດຈຳ ແລະ ສະຕັອກ Optical ກ່ອນ",note:"ເປັນເງິນມັດຈຳ ບໍ່ແມ່ນຈ່າຍເຕັມ"}
} as const;
export function PosOpticalDepositDialog({total,currency,language,onClose,onSubmit}:Props){
 const [input,setInput]=useState("");
 const [step,setStep]=useState<"amount"|"method">("amount");
 const [method,setMethod]=useState<OpticalDepositMethod>("cash");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const T=languages[language];
 const amount=resolveOpticalDeposit(input,total,currency);
 const money=(value:number)=>formatSalesMoney(Math.max(0,value),currency);
 useEffect(()=>{
   const onKey=(event:KeyboardEvent)=>{if(event.key==="Escape"&&!busy)onClose();};
   document.addEventListener("keydown",onKey);
   return()=>document.removeEventListener("keydown",onKey);
 },[onClose,busy]);
 const press=(key:string)=>{
   setError("");
   if(key==="C")setInput("");
   else if(key==="⌫")setInput(v=>v.slice(0,-1));
   else setInput(v=>sanitizeOpticalDepositInput(v+key,currency));
 };
 const proceed=()=>{
   if(amount===null){setError(T.error);return;}
   setError("");setStep("method");
 };
 const pay=async()=>{
   if(amount===null){setError(T.error);return;}
   if(!onSubmit){setError(T.unavailable);return;}
   setBusy(true);setError("");
   try{await onSubmit(amount,method);onClose();}
   catch(e){setError(e instanceof Error?e.message:T.unavailable);}
   finally{setBusy(false);}
 };
 return <div className="fixed inset-0 z-[180] flex items-center justify-center overflow-y-auto bg-slate-950/55 p-2 sm:p-4" role="presentation">
   <section role="dialog" aria-modal="true" aria-labelledby="optical-deposit-title"
     data-testid="optical-deposit-dialog"
     className="my-auto flex max-h-[calc(100dvh-16px)] w-full max-w-[650px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
     <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
       <div><h2 id="optical-deposit-title" className="text-lg font-bold">{step==="amount"?T.title:T.step2}</h2>
         <p className="text-xs text-slate-500">{step==="amount"?T.hint:T.note}</p></div>
       <button type="button" disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2" onClick={onClose}>{T.close}</button>
     </header>
     <div className="min-h-0 space-y-3 overflow-y-auto px-4 py-3">
       <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
         <div className="flex justify-between gap-3"><span>{T.total}</span><strong>{money(total)}</strong></div>
         <div className="mt-2 flex justify-between gap-3"><span>{T.due}</span><strong className="text-xl text-emerald-700" data-testid="optical-deposit-amount">{money(amount??0)}</strong></div>
         <div className="mt-2 flex justify-between gap-3"><span>{T.balance}</span><strong>{money(total-(amount??0))}</strong></div>
       </div>
       {step==="amount"?
         <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_210px]">
           <div className="space-y-2">
             <label htmlFor="optical-deposit-amount-input" className="text-sm font-semibold">{T.due} ({currency})</label>
             <input id="optical-deposit-amount-input" inputMode="decimal" autoComplete="off" value={input} onChange={e=>{setInput(sanitizeOpticalDepositInput(e.target.value,currency));setError("");}}
               className="h-14 w-full min-w-0 rounded-lg border border-slate-300 px-3 text-right text-2xl font-bold tabular-nums"
               placeholder="0" aria-describedby="optical-deposit-error"/>
             <p className="text-xs text-slate-500">{T.note}</p>
           </div>
           <div className="grid grid-cols-3 gap-2" aria-label="Deposit keypad">
             {["1","2","3","4","5","6","7","8","9","C","0",currency==="LAK"?"⌫":"."].map((key,i)=>
               <button key={i} type="button" className="min-h-11 rounded-lg border border-slate-300 bg-slate-50 text-lg font-bold active:bg-emerald-100"
                 onClick={()=>press(key)} aria-label={key==="C"?T.clear:key==="⌫"?T.del:key}>{key==="C"?T.clear:key}</button>)}
             {currency!=="LAK"?<button type="button" className="col-span-3 min-h-10 rounded-lg border border-slate-300 text-sm font-semibold" onClick={()=>press("⌫")}>{T.del}</button>:null}
           </div>
         </div>:
         <fieldset className="grid grid-cols-2 gap-3">
           <legend className="mb-2 text-sm font-semibold">{T.step2}</legend>
           <label className={`cursor-pointer rounded-xl border p-3 text-center font-bold ${method==="cash"?"border-emerald-600 bg-emerald-50":"border-slate-300"}`}>
             <input type="radio" className="mr-2" checked={method==="cash"} onChange={()=>setMethod("cash")}/>{T.cash}
           </label>
           <label className={`cursor-pointer rounded-xl border p-3 text-center font-bold ${method==="bank_transfer"?"border-emerald-600 bg-emerald-50":"border-slate-300"}`}>
             <input type="radio" className="mr-2" checked={method==="bank_transfer"} onChange={()=>setMethod("bank_transfer")}/>{T.transfer}
           </label>
         </fieldset>}
       {error?<p id="optical-deposit-error" role="alert" className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p>:null}
       {step==="method"&&!onSubmit?<p role="note" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{T.unavailable}</p>:null}
     </div>
     <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">
       <button type="button" disabled={busy} className="min-h-11 rounded-lg border border-slate-300 px-4 py-2" onClick={step==="method"?()=>setStep("amount"):onClose}>{step==="method"?T.back:T.close}</button>
       {step==="amount"?
         <button type="button" className="min-h-11 rounded-lg bg-orange-500 px-5 py-2 font-bold text-white disabled:opacity-50"
           disabled={amount===null} onClick={proceed}>{T.continue}</button>:
         <button type="button" className="min-h-11 rounded-lg bg-emerald-700 px-5 py-2 font-bold text-white disabled:opacity-50"
           disabled={busy||!onSubmit} onClick={()=>void pay()}>{T.confirm}</button>}
     </footer>
   </section>
 </div>;
}
