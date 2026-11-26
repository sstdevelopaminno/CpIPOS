"use client";
import {useRouter} from "next/navigation";
import {useEffect,useRef,useState} from "react";
import {RecyclingAmountCorrectionEditor} from "@/components/pos/recycling-amount-correction-editor";
import {RecyclingDocumentTimeEditor} from "@/components/pos/recycling-document-time-editor";
import {RecyclingReceiptDialog} from "@/components/pos/recycling-receipt-dialog";
import {RecyclingVoidTransaction} from "@/components/pos/recycling-void-transaction";
type Mode="receipt"|"void";
export function RecyclingSalesListRowActions({receiptId,receiptNo,createdAt,direction,settlement,status,amountMinor,canManage,voidEnabled,directDateEnabled=false,amountCorrectionEnabled=false}:{
 receiptId:string;receiptNo:string;createdAt:string;direction:"buy"|"sell";settlement:"cash"|"bank_transfer"|"credit";status:"posted"|"voided";amountMinor:number;canManage:boolean;voidEnabled:boolean;directDateEnabled?:boolean;amountCorrectionEnabled?:boolean;
}){
 const router=useRouter();
 const [mode,setMode]=useState<Mode|null>(null);
 const receiptRef=useRef<HTMLButtonElement>(null),voidRef=useRef<HTMLButtonElement>(null),closeRef=useRef<HTMLButtonElement>(null);
 useEffect(()=>{if(mode==="void")window.requestAnimationFrame(()=>closeRef.current?.focus());},[mode]);
 function close(){const previous=mode;setMode(null);window.requestAnimationFrame(()=>{if(previous==="void")voidRef.current?.focus();else receiptRef.current?.focus();});}
 return <>
 <div className="flex flex-wrap items-center gap-1.5" data-testid="recycling-sales-list-row-actions">
 <button type="button" ref={receiptRef} onClick={()=>setMode("receipt")} className="min-h-9 whitespace-nowrap rounded-md border border-blue-200 bg-white px-2.5 text-xs font-bold text-blue-700 hover:bg-blue-50">ดู / พิมพ์</button>
 {canManage&&status==="posted"&&directDateEnabled&&<RecyclingDocumentTimeEditor id={receiptId} currentAt={createdAt} receiptNo={receiptNo} direction={direction} amountMinor={amountMinor} source="pos" onSaved={()=>router.refresh()}/>}
 {canManage&&status==="posted"&&amountCorrectionEnabled&&<RecyclingAmountCorrectionEditor id={receiptId} source="pos" onSaved={()=>router.refresh()}/>}
 {canManage&&status==="posted"&&!directDateEnabled&&<button type="button" disabled title="ระบบแก้ไขโดยตรงยังไม่เปิดใช้งาน" className="min-h-9 rounded-md border border-slate-200 px-2.5 text-xs font-bold text-slate-400">แก้ไขบิล</button>}
 {canManage&&<button type="button" ref={voidRef} disabled={status!=="posted"||!voidEnabled} onClick={()=>setMode("void")} className="min-h-9 whitespace-nowrap rounded-md border border-rose-200 bg-white px-2.5 text-xs font-bold text-rose-800 disabled:opacity-40">ยกเลิก (VOID)</button>}
 </div>
 <RecyclingReceiptDialog transactionId={receiptId} receiptNo={receiptNo} open={mode==="receipt"} onClose={close}/>
 {mode==="void"&&<div role="presentation" className="fixed inset-0 z-[1760] flex items-center justify-center bg-slate-950/60 p-3"><section role="dialog" aria-modal="true" aria-labelledby="recycling-document-action-title" data-testid="recycling-document-action-modal" onKeyDown={e=>{if(e.key==="Escape"){e.preventDefault();e.stopPropagation();close();}}} className="flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white shadow-xl">
 <header className="flex justify-between gap-3 border-b border-slate-200 p-4"><div><h2 id="recycling-document-action-title" className="text-lg font-extrabold">ยกเลิกบิล</h2><p className="mt-1 text-xs text-slate-600">{receiptNo} · {direction==="buy"?"รับซื้อเข้าร้าน":"ขายออก"} · {(amountMinor/100).toFixed(2)} บาท</p></div><button ref={closeRef} type="button" onClick={close} className="rounded border px-3 py-2 text-sm">ปิด (Esc)</button></header>
 <div className="overflow-y-auto p-4"><RecyclingVoidTransaction transactionId={receiptId} direction={direction} settlement={settlement} enabled={voidEnabled} startExpanded={true}/></div>
 </section></div>}
 </>;
}
