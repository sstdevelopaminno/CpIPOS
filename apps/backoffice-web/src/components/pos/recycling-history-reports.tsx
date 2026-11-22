import { isAuthorizedCustomGeneralSaleTenant } from "@/lib/server/recycling-general-sale-entitlement";
import { RecyclingSummaryPrintButton } from "@/components/pos/recycling-summary-print-button";
import { RecyclingSummaryWorkspace } from "@/components/pos/recycling-summary-workspace";
import Link from "next/link";
import type { PosSessionScope } from "@/lib/pos-session-guard";
import { loadRecyclingHistoryReport, type RecyclingReportKind, type RecyclingReportQuery } from "@/lib/server/recycling-history-reports";

const titles:Record<RecyclingReportKind,string>={summary:"สรุปยอดขาย",receipts:"ใบเสร็จย้อนหลัง",products:"รายการขายสินค้า"};
const unitNames:Record<string,string>={kg:"กก.",khid:"ขีด",g:"กรัม",ton:"ตัน",piece:"ชิ้น",stem:"ต้น"};
const btn="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50";
const minor=(value:number)=>new Intl.NumberFormat("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value)/100);
const when=(value:string|null)=>value?new Date(value).toLocaleString("th-TH",{timeZone:"Asia/Bangkok",day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}):"—";
const payment:Record<string,string>={cash:"เงินสด",bank_transfer:"เงินโอน (ตามรายการ)",credit:"เครดิต/ค้างชำระ"};
const directions:Record<string,string>={buy:"รับซื้อเข้าร้าน",sell:"ขายออก"};

export async function RecyclingHistoryReports({scope,kind,search}:{
 scope:PosSessionScope;kind:RecyclingReportKind;search?:RecyclingReportQuery;
}){
 let report:Awaited<ReturnType<typeof loadRecyclingHistoryReport>>;
 try{report=await loadRecyclingHistoryReport(scope,kind,search);}catch(error){
  const msg=error instanceof Error?error.message:"report_error";
  return <section role="alert" className="m-4 rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
   ไม่สามารถแสดงข้อมูล CUSTOM Recycling ที่ตรวจสอบครบถ้วนได้ ({msg}) กรุณาลดช่วงวันหรือติดต่อฝ่าย IT
  </section>;
 }
 const canUseStandard = await isAuthorizedCustomGeneralSaleTenant(scope.session.tenant_id);
 const branchNames=new Map(report.branchOptions.map(b=>[b.id,b.name]));
 const totalLines=report.lines;
 const rows=report.visible;
 const lineMap=new Map(report.transactions.map(t=>[t.id,t]));
 const pageLink=(p:number)=>"?"+new URLSearchParams({
  period:report.period,date:report.date,from:report.from,to:report.to,branch:report.branch,
  direction:report.direction,status:report.status,q:report.q,page:String(p)
 }).toString();
 return <main className={kind==="summary"?"recycling-summary-layout flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto bg-white text-slate-900":"mx-auto w-full max-w-[1450px] p-3 text-slate-900 md:p-5"} data-testid={"recycling-history-"+kind}>
  <section className={kind==="summary"?"flex min-h-0 w-full flex-1 flex-col bg-white":"rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-5"}>
   <header className={kind==="summary"?"flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 md:px-4":"flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4"}>
    <div className={kind==="summary"?"min-w-0":"min-w-0"}><Link href="/preview/pos/more" className={btn}>← กลับเมนูเพิ่มเติม</Link>
      <h1 className={kind==="summary"?"mt-2 text-base font-extrabold":"mt-4 text-xl font-extrabold"}>{titles[kind]} <span className="text-xs font-bold text-blue-700">CUSTOM Recycling</span></h1>
      <p className="mt-1 text-xs text-slate-500">ข้อมูลรับซื้อและขายออกแยกกัน · ไม่รวมกับรายการขายของ POS ทั่วไป</p></div>
    <div className="flex flex-wrap gap-2 print:hidden">
      {kind==="summary"&&<RecyclingSummaryPrintButton filters={{
       period:report.period,date:report.date,from:report.from,to:report.to,branch:report.branch,
       direction:report.direction,status:report.status,q:report.q
      }}/>}
      <Link className={btn} href="/preview/pos/sales-summary">สรุปยอดขาย</Link>
      <Link className={btn} href="/preview/pos/receipts">ใบเสร็จย้อนหลัง</Link>
      <Link className={btn} href="/preview/pos/product-sales">รายการขายสินค้า</Link>
      {canUseStandard&&<Link className={btn} href={kind==="summary"?"/preview/pos/sales-summary?report_mode=standard":
        kind==="receipts"?"/preview/pos/receipts?report_mode=standard":"/preview/pos/product-sales?report_mode=standard"}>
        ดูรายงานโหมดขายทั่วไป
      </Link>}
    </div>
   </header>
   <form method="GET" className={kind==="summary"?"mx-3 mt-3 flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-3 print:hidden md:mx-4":"mt-4 flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3 print:hidden"} aria-label="ตัวกรองรายงาน">
     <label className="text-xs font-semibold">ช่วงเวลา
       <select name="period" defaultValue={report.period} className="mt-1 block h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm">
        <option value="day">รายวัน</option><option value="month">รายเดือน</option>
        <option value="year">รายปี</option><option value="custom">กำหนดเอง</option>
       </select>
     </label>
     <label className="text-xs font-semibold">วันที่อ้างอิง<input name="date" type="date" defaultValue={report.date} className="mt-1 block h-10 rounded-lg border border-slate-300 px-2 text-sm"/></label>
     <label className="text-xs font-semibold">จากวันที่<input name="from" type="date" defaultValue={report.from} className="mt-1 block h-10 rounded-lg border border-slate-300 px-2 text-sm"/></label>
     <label className="text-xs font-semibold">ถึงวันที่<input name="to" type="date" defaultValue={report.to} className="mt-1 block h-10 rounded-lg border border-slate-300 px-2 text-sm"/></label>
     <label className="text-xs font-semibold">สาขา<select name="branch" defaultValue={report.branch} className="mt-1 block h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm">
       {report.branchOptions.length>1&&["owner","manager"].includes(scope.session.role)&&<option value="all">ทุกสาขาที่ได้รับสิทธิ์</option>}
       {report.branchOptions.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
     </select></label>
     {kind!=="products"&&<label className="text-xs font-semibold">ประเภท
       <select name="direction" defaultValue={report.direction} className="mt-1 block h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm">
       <option value="all">ทั้งหมด</option><option value="buy">รับซื้อ</option><option value="sell">ขายออก</option></select></label>}
     <label className="text-xs font-semibold">สถานะ<select name="status" defaultValue={report.status} className="mt-1 block h-10 rounded-lg border border-slate-300 bg-white px-2 text-sm">
       <option value="all">ทั้งหมด</option><option value="posted">บันทึกแล้ว</option><option value="voided">VOID</option></select></label>
     {kind!=="summary"&&<label className="text-xs font-semibold">{kind==="products"?"ค้นหาบิล / วัสดุ / SKU":"ค้นหาบิล / ผู้ติดต่อ"}<input name="q" defaultValue={report.q} maxLength={80} className="mt-1 block h-10 w-36 rounded-lg border border-slate-300 px-2 text-sm"/></label>}
     <button type="submit" className="h-10 rounded-lg bg-blue-700 px-4 text-sm font-bold text-white">ดูรายการ</button>
   </form>
   <p className={kind==="summary"?"mx-3 mt-2 text-xs text-slate-600 md:mx-4":"mt-3 text-xs text-slate-600"}>ช่วง {report.from} ถึง {report.to} · สกุลเงิน THB · เงินโอนแสดงจากรายการ ไม่ใช่การยืนยันจากธนาคาร</p>
   {kind==="summary"&&<RecyclingSummaryWorkspace report={report} branchNames={Object.fromEntries(branchNames)}/>}
   {kind==="receipts"&&<div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
     <table className="w-full min-w-[950px] text-sm"><thead className="bg-slate-100"><tr>
     {["วันที่","เลขเอกสาร","ประเภทเอกสาร","สาขา","วิธีชำระ","ยอดเงิน","สถานะ","เอกสาร / พิมพ์"].map(h=><th key={h} className="px-3 py-3 text-left">{h}</th>)}</tr></thead>
     <tbody>{rows.length?rows.map(r=><tr key={r.id} className="border-t border-slate-100">
       <td className="px-3 py-3">{when(r.created_at)}</td><td className="px-3 py-3 font-mono">{r.receipt_no}</td>
       <td className="px-3 py-3">{directions[r.direction]}</td><td className="px-3 py-3">{branchNames.get(r.branch_id)}</td>
       <td className="px-3 py-3">{payment[r.settlement]}</td>
       <td className="px-3 py-3 text-right">{minor(Number(r.total_minor))}</td>
       <td className="px-3 py-3">{r.status==="voided"?"ยกเลิก (VOID)":"บันทึกแล้ว"}</td>
       <td className="px-3 py-3">{r.branch_id===report.sessionBranchId
         ? <Link className={btn} href={"/preview/pos/recycling/receipts/"+encodeURIComponent(r.id)}>ดู / พิมพ์ซ้ำ</Link>
         : <span className="text-xs text-amber-700">เข้าสู่สาขาต้นทางเพื่อพิมพ์</span>}</td>
      </tr>):<tr><td colSpan={8} className="p-10 text-center text-slate-500">ไม่พบเอกสารในช่วงเวลานี้</td></tr>}</tbody>
     </table></div>}
   {kind==="products"&&<div className="mt-4 overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[1000px] text-sm">
     <thead className="bg-slate-100"><tr>{["วันที่","เลขเอกสาร","วัสดุ / SKU","น้ำหนัก / จำนวน","ราคาต่อหน่วยฐาน","ยอดขายออก","สาขา","สถานะ"].map(h=><th key={h} className="px-3 py-3 text-left">{h}</th>)}</tr></thead>
     <tbody>{totalLines.length ? totalLines.filter(l=>rows.some(r=>r.id===l.transaction_id)).map(l=>{
       const t=lineMap.get(l.transaction_id);if(!t)return null;
       return <tr key={l.id} className="border-t border-slate-100">
         <td className="px-3 py-3">{when(t.created_at)}</td><td className="px-3 py-3">{t.receipt_no}</td>
         <td className="px-3 py-3">{l.name_snapshot}<span className="block text-xs text-slate-500">{l.sku_snapshot}</span></td>
         <td className="px-3 py-3">{Number(l.original_quantity).toLocaleString("th-TH",{maximumFractionDigits:6})} {unitNames[l.original_unit]??l.original_unit}</td>
         <td className="px-3 py-3">{Number(l.price_per_base).toFixed(2)} บาท/{unitNames[l.base_unit]??l.base_unit}</td>
         <td className="px-3 py-3">{minor(Number(l.amount_minor))}</td><td className="px-3 py-3">{branchNames.get(t.branch_id)}</td>
         <td className="px-3 py-3">{t.status==="voided"?"VOID":"ขายออก"}</td>
       </tr>;
     }):<tr><td colSpan={8} className="p-10 text-center text-slate-500">ไม่พบวัสดุขายออกในช่วงเวลานี้</td></tr>}</tbody>
   </table></div>}
   {kind!=="summary"&&<footer className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
     <span>{report.transactions.length} เอกสาร · หน้า {report.page}/{report.pages}</span>
     <div className="flex gap-2">
       {report.page>1&&<Link className={btn} href={pageLink(report.page-1)}>ก่อนหน้า</Link>}
       {report.page<report.pages&&<Link className={btn} href={pageLink(report.page+1)}>ถัดไป</Link>}
     </div>
   </footer>}
   <p className={kind==="summary"?"mx-3 mb-3 mt-2 text-xs text-slate-500 md:mx-4":"mt-4 text-xs text-slate-500"}>เอกสาร Recycling เป็นหลักฐานการซื้อขายทั่วไป ไม่ใช่ใบกำกับภาษี · รายงานนี้ไม่รวมบิล POS ทั่วไปหรือรายการ VOID ในยอดเงินจริง</p>
  </section>
 </main>;
}
