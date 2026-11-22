"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RecyclingHistoryReport } from "@/lib/server/recycling-history-reports";
import { buildRecyclingShiftSnapshots, recyclingSummaryChart } from "@/lib/recycling-summary-view-model";
import { RecyclingShiftPrintButton } from "@/components/pos/recycling-shift-control";
import { RecyclingReceiptDialog } from "@/components/pos/recycling-receipt-dialog";

type SummaryData=Pick<RecyclingHistoryReport,
 "transactions"|"shiftTransactions"|"shifts"|"totals"|"date"|"from"|"to"|"period"|"sessionBranchId">;

const money=(minor:number|null|undefined)=>minor===null||minor===undefined?"—":
 (minor/100).toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2});
const stamp=(iso:string|null)=>iso?new Date(iso).toLocaleString("th-TH",{
 timeZone:"Asia/Bangkok",year:"numeric",month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit"
}):"—";
const label=(direction:string)=>direction==="buy"?"รับซื้อเข้าร้าน":"ขายออก";
const payment=(settlement:string)=>settlement==="cash"?"เงินสด":settlement==="bank_transfer"?"โอนเงิน (ยังไม่ยืนยันธนาคาร)":"เครดิต";
const buttonBase="inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50";

export function RecyclingSummaryWorkspace({report,branchNames}:{report:SummaryData;branchNames:Record<string,string>}){
 const [view,setView]=useState<"chart"|string|null>(null);
 const [receipt,setReceipt]=useState<{id:string;no:string}|null>(null);
 const closeRef=useRef<HTMLButtonElement>(null);
 const openerRef=useRef<HTMLButtonElement>(null);
 const snapshots=useMemo(()=>buildRecyclingShiftSnapshots(report.shifts,report.shiftTransactions),
  [report.shifts,report.shiftTransactions]);
 const chart=useMemo(()=>recyclingSummaryChart(report.transactions,report.period,report.from,report.to),
  [report.transactions,report.period,report.from,report.to]);
 const maxBar=Math.max(1,...chart.map(x=>Math.max(x.buyMinor,x.sellMinor)));
 const selected=view&&view!=="chart"?snapshots.find(item=>item.shift.id===view):null;
 const summary=[
  {title:"รับซื้อเข้าร้าน",value:report.totals.buyMinor,sub:"เงินที่ต้องจ่ายให้ผู้ขายวัสดุ"},
  {title:"ขายออกให้ลูกค้า / โรงงาน",value:report.totals.sellMinor,sub:"ยอดขายวัสดุออกจากร้าน"},
  {title:"เงินสดจ่ายรับซื้อ",value:report.totals.cashOutMinor,sub:"เงินสดออกตามบิล"},
  {title:"เงินสดรับจากขายออก",value:report.totals.cashInMinor,sub:"เงินสดเข้าตามบิล"},
  {title:"ยอดโอนจ่ายที่ระบุ",value:report.totals.transferOutMinor,sub:"ไม่ใช่หลักฐานยืนยันจากธนาคาร"},
  {title:"ยอดโอนรับที่ระบุ",value:report.totals.transferInMinor,sub:"ไม่ใช่หลักฐานยืนยันจากธนาคาร"},
  {title:"ซื้อเข้าแบบเครดิต",value:report.totals.creditOutMinor,sub:"เจ้าหนี้ที่ยังไม่ชำระ"},
  {title:"ขายออกแบบเครดิต",value:report.totals.creditInMinor,sub:"ลูกหนี้ที่ยังไม่รับชำระ"},
 ];
 useEffect(()=>{
  if(view)window.requestAnimationFrame(()=>closeRef.current?.focus());
 },[view]);
 function close(){
  setView(null);
  window.requestAnimationFrame(()=>openerRef.current?.focus());
 }
 function openShift(id:string){setView(id);}
 return <section data-testid="recycling-summary-workspace" className="min-w-0 px-3 pb-3 md:px-4">
  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
   <div className="min-w-0">
    <h2 className="text-base font-extrabold text-slate-900">สรุปกะที่มีธุรกรรม Recycling</h2>
    <p className="mt-1 text-xs leading-5 text-slate-500">
     รับซื้อ {report.totals.buyCount} บิล · ขายออก {report.totals.sellCount} บิล ·
     VOID {report.totals.voidCount} บิล (ไม่รวมในยอดเงิน) · ไม่ปะปนยอดขาย POS ปกติ
    </p>
   </div>
   <button type="button" ref={openerRef} data-testid="recycling-summary-chart-open"
    onClick={()=>setView("chart")}
    className="inline-flex min-h-10 items-center gap-2 rounded-md bg-blue-700 px-4 text-sm font-bold text-white hover:bg-blue-800">
    <span aria-hidden="true">▥</span> ดูภาพรวมและกราฟ
   </button>
  </div>

  <div className="mt-3 overflow-x-auto rounded-md border border-slate-200" data-testid="recycling-summary-shift-table">
   <table className="w-full min-w-[1180px] text-xs">
    <thead className="bg-slate-100 text-slate-700"><tr>
     {["เปิดกะ","ปิดกะ","สาขา","รับซื้อ (จ่าย)","ขายออก (รับ)","ทุนเงินสดต้นกะ",
       "เงินสดคงเหลือตามระบบ","เงินนับจริง","ส่วนต่าง","สถานะ","จัดการ"].map(t=>
       <th key={t} scope="col" className="whitespace-nowrap px-3 py-3 text-left font-bold">{t}</th>)}
    </tr></thead>
    <tbody className="divide-y divide-slate-100">
     {snapshots.length ? snapshots.map(s=>{
      const closed=s.shift.status==="closed";
      return <tr key={s.shift.id} className="align-middle hover:bg-blue-50/50" data-testid="recycling-summary-shift-row">
       <td className="whitespace-nowrap px-3 py-3">{stamp(s.shift.opened_at)}</td>
       <td className="whitespace-nowrap px-3 py-3">{s.shift.closed_at?stamp(s.shift.closed_at):"—"}</td>
       <td className="px-3 py-3">{branchNames[s.shift.branch_id]??"—"}</td>
       <td className="whitespace-nowrap px-3 py-3 font-semibold text-rose-800">{money(s.money.buyMinor)}</td>
       <td className="whitespace-nowrap px-3 py-3 font-semibold text-emerald-800">{money(s.money.sellMinor)}</td>
       <td className="whitespace-nowrap px-3 py-3">{money(s.openingMinor)}</td>
       <td className="whitespace-nowrap px-3 py-3 font-semibold">{money(s.expectedMinor)}</td>
       <td className="whitespace-nowrap px-3 py-3">{s.actualMinor===null?"ยังไม่ได้นับ":money(s.actualMinor)}</td>
       <td className={"whitespace-nowrap px-3 py-3 "+(s.differenceMinor!==null&&s.differenceMinor<0?"text-rose-700":"")}>
        {s.differenceMinor===null?"—":money(s.differenceMinor)}
       </td>
       <td className="px-3 py-3"><span className={"inline-flex whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-bold "+(closed?
         "bg-slate-100 text-slate-700":"bg-emerald-50 text-emerald-800")}>
         {closed?"ปิดกะแล้ว":"เปิดกะอยู่"}</span>
       </td>
       <td className="whitespace-nowrap px-3 py-2">
        <button type="button" onClick={()=>openShift(s.shift.id)}
         aria-label={"ดูรายละเอียดและพิมพ์กะ "+stamp(s.shift.opened_at)}
         className="min-h-9 rounded-md border border-blue-300 bg-white px-3 text-xs font-bold text-blue-700 hover:bg-blue-50">
         ดูกะ / พิมพ์
        </button>
       </td>
      </tr>;
     }):<tr><td colSpan={11} className="p-12 text-center text-slate-500">
      ไม่มีกะที่มีรายการรับซื้อหรือขายออกตามเงื่อนไขที่เลือก
     </td></tr>}
    </tbody>
   </table>
  </div>
  <p className="mt-2 text-[11px] leading-5 text-slate-500">
   เงินสดคงเหลือตามระบบใช้ยอดปิดกะที่บันทึกไว้ (ถ้ามี) มิฉะนั้นคำนวณจากทุนต้นกะ
   บวกเงินสดรับขายออก ลบเงินสดจ่ายรับซื้อในช่วงข้อมูลที่เลือก ·
   เงินสดนับจริงและส่วนต่างจะมีเมื่อบันทึกการนับปิดกะ
  </p>

  {view&&<div role="presentation"
   className="fixed inset-0 z-[1550] flex items-center justify-center bg-slate-950/65 p-2 sm:p-4"
   data-testid="recycling-summary-modal-backdrop">
   <section role="dialog" aria-modal="true"
    aria-labelledby="recycling-summary-modal-title"
    onKeyDown={event=>{
     if(event.key==="Escape"&&!receipt){event.preventDefault();event.stopPropagation();close();}
    }}
    className="flex max-h-[94dvh] w-full max-w-5xl min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
     <div className="min-w-0">
      <h3 id="recycling-summary-modal-title" className="text-base font-extrabold text-slate-900">
       {view==="chart"?"ภาพรวมการรับซื้อ–ขายออก Recycling":"รายละเอียดกะและรายงานเงินสด Recycling"}
      </h3>
      <p className="mt-1 text-xs text-slate-600">
       {view==="chart"?"ช่วง "+report.from+" ถึง "+report.to+" · ข้อมูลจากเอกสารบันทึกแล้ว":
        selected?branchNames[selected.shift.branch_id]??"สาขา":"กรุณาเลือกกะ"}
      </p>
     </div>
     <button type="button" ref={closeRef} onClick={close}
      className={buttonBase}>ปิด (Esc)</button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto bg-white p-3 sm:p-4">
     {view==="chart"&&<>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4" data-testid="recycling-summary-chart-metrics">
       {summary.map(item=><div key={item.title} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
        <p className="text-xs font-semibold text-slate-600">{item.title}</p>
        <strong className="mt-1 block text-lg tabular-nums text-blue-900">{money(item.value)} บาท</strong>
        <p className="mt-1 text-[11px] text-slate-500">{item.sub}</p>
       </div>)}
      </div>
      <div className="mt-4 rounded-lg border border-slate-200 p-3" data-testid="recycling-summary-chart">
       <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h4 className="text-sm font-extrabold">กราฟยอดรับซื้อ–ขายออก</h4>
         <p className="mt-1 text-[11px] text-slate-500">บาทตามช่วงเวลา · ไม่รวมรายการ VOID</p>
        </div>
        <div className="flex gap-3 text-xs"><span className="text-rose-700">■ รับซื้อ (เงินจ่าย)</span>
         <span className="text-emerald-700">■ ขายออก (เงินรับ)</span></div>
       </div>
       <div className="mt-4 overflow-x-auto">
        <div className="flex h-56 items-end gap-1 border-b border-slate-200 pb-2"
         style={{minWidth:Math.max(340,chart.length*38)}}>
         {chart.map(item=><div key={item.key} className="flex min-w-0 flex-1 flex-col items-center gap-1"
          aria-label={item.label+" รับซื้อ "+money(item.buyMinor)+" บาท ขายออก "+money(item.sellMinor)+" บาท"}>
          <div className="flex h-44 w-full items-end justify-center gap-1">
           <div title={"รับซื้อ "+money(item.buyMinor)+" บาท"}
            className="w-3 max-w-[43%] rounded-t-sm bg-rose-500"
            style={{height:(item.buyMinor>0?Math.max(3,item.buyMinor/maxBar*100):0)+"%"}}/>
           <div title={"ขายออก "+money(item.sellMinor)+" บาท"}
            className="w-3 max-w-[43%] rounded-t-sm bg-emerald-500"
            style={{height:(item.sellMinor>0?Math.max(3,item.sellMinor/maxBar*100):0)+"%"}}/>
          </div>
          <span className="w-full truncate text-center text-[10px] tabular-nums text-slate-500">{item.label}</span>
         </div>)}
        </div>
       </div>
       {report.totals.buyCount+report.totals.sellCount===0&&<p className="mt-3 text-center text-xs text-slate-500">ไม่มีรายการบันทึกแล้วในช่วงที่เลือก</p>}
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-500">
       รายงานรับซื้อคือเงินจ่ายเพื่อซื้อวัสดุ ส่วนขายออกคือยอดขายวัสดุ ทั้งสองอย่างไม่ใช่กำไรสุทธิ
       และยอดโอนยังไม่ใช่หลักฐานยืนยันการรับ–จ่ายจากธนาคาร
      </p>
     </>}
     {selected&&<div data-recycling-shift-print="true" className="recycling-report-print-target">
      <div className="mb-3 border-b border-slate-200 pb-3">
       <h4 className="text-base font-extrabold">รายงานธุรกรรมกะ Recycling</h4>
       <p className="text-xs text-slate-600">
        {branchNames[selected.shift.branch_id]??"สาขา"} · เปิดกะ {stamp(selected.shift.opened_at)}
        {selected.shift.closed_at?" · ปิดกะ "+stamp(selected.shift.closed_at):" · กะยังเปิดอยู่ (รายงานชั่วคราว)"}
       </p>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
       {[
        ["ทุนเงินสดต้นกะ",selected.openingMinor],
        ["รับซื้อเข้าร้าน (จ่าย)",selected.money.buyMinor],
        ["ขายออกจากร้าน (รับ)",selected.money.sellMinor],
        ["เงินสดจ่ายรับซื้อ",selected.money.cashOutMinor],
        ["เงินสดรับขายออก",selected.money.cashInMinor],
        ["เงินสดคงเหลือตามระบบ",selected.expectedMinor],
        ["เงินสดนับจริง",selected.actualMinor],
        ["ส่วนต่างเงินสด",selected.differenceMinor],
       ].map(([key,value])=><div key={String(key)} className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs text-slate-600">{key}</p><strong className="mt-1 block text-base tabular-nums">{money(value as number|null)} บาท</strong>
       </div>)}
      </div>
      <p className="mt-3 text-xs text-slate-600">
       บิลรับซื้อ {selected.money.buyCount} · ขายออก {selected.money.sellCount} · ยกเลิก (VOID) {selected.money.voidCount}
       · เงินโอนที่ระบุ {money(selected.money.transferInMinor+selected.money.transferOutMinor)} บาท (ยังไม่ยืนยันธนาคาร)
      </p>
      <h5 className="mb-2 mt-4 text-sm font-bold">รายการรับซื้อ–ขายออกในกะ</h5>
      <div className="overflow-x-auto rounded-md border border-slate-200">
       <table className="w-full min-w-[720px] text-xs" data-testid="recycling-shift-modal-transactions">
        <thead className="bg-slate-100"><tr>
         {["เวลา","เลขเอกสาร","ประเภท","วิธีชำระ","ยอดเงิน (บาท)","สถานะ","เอกสาร"].map(h=>
         <th key={h} className="px-3 py-2 text-left font-bold">{h}</th>)}
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
         {selected.transactions.length?selected.transactions.map(tx=><tr key={tx.id}>
          <td className="whitespace-nowrap px-3 py-2">{stamp(tx.created_at)}</td>
          <td className="break-all px-3 py-2 font-mono">{tx.receipt_no}</td>
          <td className="px-3 py-2">{label(tx.direction)}</td>
          <td className="px-3 py-2">{payment(tx.settlement)}</td>
          <td className="px-3 py-2 text-right tabular-nums">{money(tx.total_minor)}</td>
          <td className="px-3 py-2">{tx.status==="voided"?"ยกเลิก (VOID)":"บันทึกแล้ว"}</td>
          <td className="px-3 py-2 print:hidden">
           {tx.branch_id===report.sessionBranchId?
            <button type="button" onClick={()=>setReceipt({id:tx.id,no:tx.receipt_no})}
             className="rounded-md border border-blue-300 px-2 py-1 text-blue-700">
             ดูใบเสร็จ
            </button>:
            <span className="text-slate-500">ดูได้จากสาขาต้นทาง</span>}
          </td>
         </tr>):<tr><td colSpan={7} className="p-8 text-center text-slate-500">ไม่พบธุรกรรมในกะนี้</td></tr>}
        </tbody>
       </table>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-slate-500">
       รายงานนี้อ้างอิงข้อมูลในช่วง {report.from} ถึง {report.to} ตามตัวกรอง
       · ไม่รวม VOID ในยอดเงินจริง · เอกสารภายใน ไม่ใช่ใบกำกับภาษี
       {!selected.shift.closed_at?" · กะยังไม่ปิด ตัวเลขยังเปลี่ยนได้":""}
      </p>
     </div>}
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3 print:hidden">
     {selected&&<>
      <button type="button" onClick={()=>window.print()} data-testid="recycling-shift-print-browser"
       className={buttonBase}>พิมพ์รายงานกะ (A4/A5)</button>
      {selected.shift.status==="closed"&&selected.shift.branch_id===report.sessionBranchId&&
       <RecyclingShiftPrintButton shiftId={selected.shift.id}/>}
      {selected.shift.status!=="closed"&&<p className="mr-auto text-xs text-amber-800">
       กะยังเปิดอยู่ · พิมพ์เป็นรายงานชั่วคราวเท่านั้น
      </p>}
     </>}
     <button type="button" onClick={close}
      className="min-h-10 rounded-md bg-blue-700 px-5 text-sm font-bold text-white">ตกลง / ปิด</button>
    </footer>
   </section>
  </div>}
  {receipt&&<RecyclingReceiptDialog transactionId={receipt.id} receiptNo={receipt.no}
   open={true} onClose={()=>setReceipt(null)}/>}
 </section>;
}
