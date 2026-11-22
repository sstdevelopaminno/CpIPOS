import Link from "next/link";
import type {PosSessionScope} from "@/lib/pos-session-guard";
import {loadRecyclingHistoryReport,type RecyclingReportQuery} from "@/lib/server/recycling-history-reports";
import {RecyclingReportDocumentAction} from "@/components/pos/recycling-report-document-action";

const button="inline-flex min-h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50";
const stamp=(date:string)=>new Date(date).toLocaleString("th-TH",{
 timeZone:"Asia/Bangkok",day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"
});
const money=(minor:number)=>(Number(minor)/100).toLocaleString("th-TH",{
 minimumFractionDigits:2,maximumFractionDigits:2
});

/** No recycling transaction carries a verified tax-invoice/VAT snapshot.
 * Existing standard tax-invoice endpoint only accepts completed POS orders,
 * not recycling_transactions: do not call it from here or fabricate tax.
 */
export async function RecyclingTaxInvoiceRegister({scope,search}:{
 scope:PosSessionScope;search?:RecyclingReportQuery;
}){
 let report:Awaited<ReturnType<typeof loadRecyclingHistoryReport>>;
 try{
  report=await loadRecyclingHistoryReport(scope,"receipts",{...search,direction:"sell"});
 }catch(error){
  return <main className="recycling-tax-register-layout h-full w-full min-w-0 bg-white p-4" role="alert">
   ไม่สามารถอ่านทะเบียนขายออก Recycling ได้ ({error instanceof Error?error.message:"report_unavailable"})
  </main>;
 }
 const names=new Map(report.branchOptions.map(b=>[b.id,b.name]));
 const pageLink=(page:number)=>"?"+new URLSearchParams({
  period:report.period,date:report.date,from:report.from,to:report.to,
  branch:report.branch,status:report.status,q:report.q,page:String(page)
 }).toString();
 return <main className="recycling-tax-register-layout flex h-full min-h-0 w-full min-w-0 flex-col overflow-y-auto bg-white text-slate-900"
   data-testid="recycling-tax-invoice-register">
  <section className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
   <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 md:px-4">
    <div className="min-w-0">
     <Link href="/preview/pos/more" className={button}>← กลับเมนูเพิ่มเติม</Link>
     <h1 className="mt-2 text-base font-extrabold">เอกสารภาษีจากการขายวัสดุรีไซเคิล <span className="text-xs font-bold text-blue-700">CUSTOM Recycling</span></h1>
     <p className="mt-1 text-xs text-slate-600">ทะเบียนตรวจสอบหลักฐานขายออก · ไม่ใช้บิล POS ทั่วไป</p>
    </div>
    <nav className="flex flex-wrap gap-2 print:hidden" aria-label="เมนูรายงาน Recycling">
     <Link href="/preview/pos/sales-summary" className={button}>สรุปซื้อ–ขาย</Link>
     <Link href="/preview/pos/receipts" className={button}>ใบเสร็จย้อนหลัง</Link>
     <Link href="/preview/pos/product-sales" className={button}>รายการวัสดุขายออก</Link>
    </nav>
   </header>
   <div className="mx-3 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 md:mx-4" role="status">
    <h2 className="text-sm font-extrabold text-amber-950">เงื่อนไขก่อนออกใบกำกับภาษี</h2>
    <p className="mt-1 text-xs leading-6 text-amber-950">
     เอกสารรับซื้อ–ขายออก Recycling ปัจจุบันเป็นหลักฐานซื้อขายทั่วไป ยังไม่มีข้อมูล VAT
     และการตรวจสถานะผู้ประกอบการจดทะเบียน VAT ที่ผูกกับเอกสารแต่ละฉบับอย่างครบถ้วน
     ระบบจึงยังไม่เปิดให้สร้างใบกำกับภาษีจากบิลเหล่านี้อัตโนมัติ
     เพื่อป้องกันการออกเอกสารภาษีผิดประเภทหรือยอดภาษีไม่ตรงกับบัญชี
    </p>
    <p className="mt-1 text-xs text-amber-900">
     สามารถดูและพิมพ์ <strong>หลักฐานขายออกเดิม</strong> ผ่าน Popup ได้
     แต่เอกสารที่พิมพ์ไม่ใช่ใบกำกับภาษี และยังไม่ยืนยันว่ามีหรือไม่มีเอกสารภาษีภายนอกระบบ
    </p>
   </div>
   <form method="GET" aria-label="ค้นหาเอกสารขายออกสำหรับตรวจภาษี"
    className="mx-3 mt-3 flex flex-wrap items-end gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 md:mx-4">
    <label className="text-xs font-semibold">ช่วงเวลา
     <select name="period" defaultValue={report.period} className="mt-1 block h-10 rounded-md border border-slate-300 bg-white px-3 text-sm">
      <option value="day">รายวัน</option><option value="month">รายเดือน</option>
      <option value="year">รายปี</option><option value="custom">กำหนดเอง</option>
     </select>
    </label>
    <label className="text-xs font-semibold">วันที่อ้างอิง
     <input name="date" type="date" defaultValue={report.date} className="mt-1 block h-10 rounded-md border border-slate-300 bg-white px-2 text-sm"/>
    </label>
    <label className="text-xs font-semibold">จากวันที่
     <input name="from" type="date" defaultValue={report.from} className="mt-1 block h-10 rounded-md border border-slate-300 bg-white px-2 text-sm"/>
    </label>
    <label className="text-xs font-semibold">ถึงวันที่
     <input name="to" type="date" defaultValue={report.to} className="mt-1 block h-10 rounded-md border border-slate-300 bg-white px-2 text-sm"/>
    </label>
    <label className="text-xs font-semibold">สาขา
     <select name="branch" defaultValue={report.branch} className="mt-1 block h-10 rounded-md border border-slate-300 bg-white px-2 text-sm">
      {report.branchOptions.length>1&&["owner","manager"].includes(scope.session.role)&&<option value="all">ทุกสาขาที่ได้รับสิทธิ์</option>}
      {report.branchOptions.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}
     </select>
    </label>
    <label className="text-xs font-semibold">สถานะ
     <select name="status" defaultValue={report.status} className="mt-1 block h-10 rounded-md border border-slate-300 bg-white px-2 text-sm">
      <option value="all">ทั้งหมด</option><option value="posted">บันทึกแล้ว</option>
      <option value="voided">VOID</option>
     </select>
    </label>
    <label className="text-xs font-semibold">เลขเอกสาร / ผู้รับซื้อ
     <input name="q" defaultValue={report.q} maxLength={80}
      className="mt-1 block h-10 w-40 rounded-md border border-slate-300 bg-white px-2 text-sm"/>
    </label>
    <button type="submit" className="min-h-10 rounded-md bg-blue-700 px-4 text-xs font-bold text-white">ค้นหา</button>
   </form>
   <p className="mx-3 mt-2 text-xs text-slate-600 md:mx-4">
    ช่วง {report.from} ถึง {report.to} · แสดงเฉพาะขายออก · ไม่แปลงบิลรับซื้อเป็นใบกำกับภาษี
   </p>
   <div className="mx-3 mt-3 min-h-[300px] min-w-0 flex-1 overflow-x-auto rounded-md border border-slate-200 md:mx-4">
    <table className="w-full min-w-[940px] text-xs">
     <thead className="bg-slate-100"><tr>
      {["วันที่","เลขเอกสารขายออก","คู่ค้า","สาขา","ยอดเงิน","สถานะบิล","สถานะภาษี","หลักฐาน / พิมพ์"].map(h=>
       <th key={h} className="px-3 py-3 text-left font-bold">{h}</th>)}
     </tr></thead>
     <tbody className="divide-y divide-slate-100">
      {report.visible.length?report.visible.map(t=><tr key={t.id}>
       <td className="whitespace-nowrap px-3 py-3">{stamp(t.created_at)}</td>
       <td className="break-all px-3 py-3 font-mono">{t.receipt_no}</td>
       <td className="px-3 py-3">{t.counterparty_name||"ไม่ระบุคู่ค้า"}</td>
       <td className="px-3 py-3">{names.get(t.branch_id)??"—"}</td>
       <td className="whitespace-nowrap px-3 py-3 text-right">{money(t.total_minor)} บาท</td>
       <td className="px-3 py-3">{t.status==="voided"?"ยกเลิก (VOID)":"บันทึกแล้ว"}</td>
       <td className="px-3 py-3 text-amber-800">ยังไม่ยืนยันการออกใบกำกับภาษี</td>
       <td className="px-3 py-3">{t.branch_id===report.sessionBranchId
        ? <RecyclingReportDocumentAction transactionId={t.id} receiptNo={t.receipt_no} label="ดูหลักฐาน / พิมพ์"/>
        : <span className="text-xs text-slate-500">เข้าสาขาต้นทางเพื่อพิมพ์</span>}</td>
      </tr>):<tr><td colSpan={8} className="p-12 text-center text-slate-500">ไม่พบเอกสารขายออกตามเงื่อนไขที่เลือก</td></tr>}
     </tbody>
    </table>
   </div>
   <footer className="mx-3 mt-3 flex items-center justify-between gap-3 text-xs text-slate-500 md:mx-4">
    <span>{report.transactions.length} เอกสารขายออก · หน้า {report.page}/{report.pages}</span>
    <div className="flex gap-2">
     {report.page>1&&<Link href={pageLink(report.page-1)} className={button}>ก่อนหน้า</Link>}
     {report.page<report.pages&&<Link href={pageLink(report.page+1)} className={button}>ถัดไป</Link>}
    </div>
   </footer>
   <p className="mx-3 mb-3 mt-2 text-[11px] leading-5 text-slate-500 md:mx-4">
    ทะเบียนนี้เป็นรายการตรวจสอบภายใน ไม่ใช่ทะเบียนใบกำกับภาษีที่ออกแล้ว และไม่บันทึก VAT เพิ่ม
   </p>
  </section>
 </main>;
}
