import Link from "next/link";
import type { PosSessionScope } from "@/lib/pos-session-guard";
import { loadRecyclingHistoryReport, type RecyclingReportQuery } from "@/lib/server/recycling-history-reports";
import { sumRecyclingReportMoney } from "@/lib/recycling-report-calculation";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { RecyclingSalesListExport } from "@/components/pos/recycling-sales-list-export";
import { RecyclingSalesListRowActions } from "@/components/pos/recycling-sales-list-row-actions";

const BASE="/preview/pos/sales-list";
const money=(minor:number)=>new Intl.NumberFormat("th-TH",{
  minimumFractionDigits:2,maximumFractionDigits:2
}).format(minor/100);
const dateTime=(value:string)=>new Intl.DateTimeFormat("th-TH",{
  timeZone:"Asia/Bangkok",day:"2-digit",month:"short",year:"numeric",
  hour:"2-digit",minute:"2-digit"
}).format(new Date(value));
function todayBangkok(){
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(new Date());
  const find=(type:string)=>parts.find(v=>v.type===type)?.value??"";
  return find("year")+"-"+find("month")+"-"+find("day");
}
const directions={buy:"รับซื้อเข้าร้าน",sell:"ขายออก"} as const;
const settlements={cash:"เงินสด",bank_transfer:"ระบุโอนเงิน · รอตรวจหลักฐาน",credit:"เครดิต / ค้างชำระ"} as const;
const button="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50";
const field="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-800 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100";

export async function RecyclingSalesListPageContent({scope,search={}}:{
  scope:PosSessionScope;search?:RecyclingReportQuery;
}){
  let report:Awaited<ReturnType<typeof loadRecyclingHistoryReport>>;
  try{
    // Query the Recycling ledger once with all directions/statuses. Filtering
    // the view locally leaves KPI totals stable when switching buy/sell tabs.
    // The server loader enforces membership, branch scope, dates and a
    // bounded transaction count. No ordinary POS orders are mixed in.
    report=await loadRecyclingHistoryReport(scope,"receipts",{
      ...search,direction:"all",status:"all",page:"1"
    });
  }catch(error){
    const code=error instanceof Error?error.message:"recycling_sales_list_unavailable";
    return <main className="w-full bg-slate-50 p-4" data-testid="recycling-sales-list-error">
      <section role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900">
        <h1 className="text-lg font-extrabold">รายการซื้อ–ขายวัสดุรีไซเคิล</h1>
        <p className="mt-2">ยังอ่านทะเบียนรับซื้อและขายออกได้ไม่ครบถ้วน ({code}) กรุณาลดช่วงวันที่หรือตรวจสอบการเชื่อมต่อก่อน</p>
      </section>
    </main>;
  }
  const direction=search.direction==="buy"||search.direction==="sell"?search.direction:"all";
  const status=search.status==="posted"||search.status==="voided"?search.status:"all";
  const filtered=report.transactions.filter(t=>
    (direction==="all"||t.direction===direction) && (status==="all"||t.status===status)
  );
  const total= sumRecyclingReportMoney(report.transactions);
  const countAll=report.transactions.length;
  const countBuy=report.transactions.filter(x=>x.direction==="buy").length;
  const countSell=report.transactions.filter(x=>x.direction==="sell").length;
  const size=20;
  const pages=Math.max(1,Math.ceil(filtered.length/size));
  const rawPage=Number(search.page??"1");
  const page=Number.isSafeInteger(rawPage)?Math.max(1,Math.min(pages,rawPage)):1;
  const visible=filtered.slice((page-1)*size,page*size);
  const branchNames=new Map(report.branchOptions.map(b=>[b.id,b.name]));
  const lineCounts=new Map<string,{count:number;first:string}>();
  if(visible.length){
    const db=getSupabaseServiceClient();
    const ids=visible.map(t=>t.id);
    const lines=await db.from("recycling_transaction_lines")
      .select("transaction_id,name_snapshot",{count:"exact"})
      .eq("tenant_id",scope.session.tenant_id)
      .in("branch_id",report.branchOptions.map(x=>x.id))
      .in("transaction_id",ids).limit(2001);
    // PostgREST can cap returned rows below our requested limit.
    // Require exact count parity so a silent cap cannot misstate item totals.
    if(lines.error||lines.count===null||lines.count>2000||
       lines.count!==(lines.data??[]).length){
      return <section role="alert" className="m-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        ไม่สามารถอ่านรายละเอียดวัสดุได้ครบ กรุณาลดช่วงวันที่หรือติดต่อฝ่าย IT
      </section>;
    }
    for(const line of lines.data??[]){
      const previous=lineCounts.get(line.transaction_id);
      if(previous)previous.count++;
      else lineCounts.set(line.transaction_id,{count:1,first:String(line.name_snapshot??"วัสดุ")});
    }
  }
  function href(next:Record<string,string>){
    const params=new URLSearchParams({
      period:report.period,date:report.date,from:report.from,to:report.to,
      branch:report.branch,direction,status,q:report.q,page:"1",...next
    });
    return BASE+"?"+params.toString();
  }
  const today=todayBangkok();
  const quick=(period:"day"|"month"|"year",name:string)=>
    <Link href={href({period,date:today,page:"1"})}
      aria-current={report.period===period?"page":undefined}
      className={"inline-flex min-h-9 items-center rounded-md border px-2.5 text-xs font-bold "+
        (report.period===period?"border-orange-500 bg-orange-500 text-white":"border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>
      {name}
    </Link>;
  const exportRows=filtered.map(t=>({
    receipt_no:t.receipt_no,created_at:t.created_at,direction:t.direction,
    counterparty_name:t.counterparty_name,settlement:t.settlement,
    total_minor:Number(t.total_minor),status:t.status,
    branch_name:branchNames.get(t.branch_id)??"—"
  }));
  return <main className="recycling-sales-list-layout flex h-full min-h-0 w-full min-w-0 flex-col bg-white text-slate-900"
    data-testid="recycling-sales-list">
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-white">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-orange-50 px-3 py-2 md:px-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-extrabold text-slate-900">รายการซื้อ–ขายวัสดุรีไซเคิล</h1>
            <span className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-800">CUSTOM Recycling</span>
          </div>
          <p className="mt-1 text-xs text-slate-600">ทะเบียนรับซื้อเข้าร้านและขายออก · บันทึกจริงแยกจากบิลขาย POS หลัก</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-start gap-x-2 gap-y-2 lg:justify-end">
          <nav aria-label="ประเภทเอกสาร Recycling"
            data-testid="recycling-sales-list-direction-tabs"
            className="flex min-w-0 flex-wrap items-center gap-1.5 lg:mr-1 lg:border-r lg:border-slate-200 lg:pr-3">
            {([
              ["all","ทั้งหมด",countAll],["buy","รับซื้อเข้าร้าน",countBuy],["sell","ขายออก",countSell]
            ] as const).map(([key,label,count])=>
              <Link key={key} href={href({direction:key,page:"1"})} aria-current={direction===key?"page":undefined}
                className={"inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-xs font-bold "+
                  (direction===key?"border-blue-700 bg-blue-700 text-white":"border-slate-300 bg-white text-slate-700 hover:bg-slate-50")}>
                {label}<span className={"rounded px-1.5 py-0.5 tabular-nums "+
                  (direction===key?"bg-white/20 text-white":"bg-slate-100 text-slate-600")}>{count}</span>
              </Link>)}
          </nav>
          <div className="flex flex-wrap items-center gap-1.5" aria-label="ช่วงเวลารายการซื้อ–ขาย">
            {quick("day","วันนี้")}
            {quick("month","รายเดือน")}
            {quick("year","รายปี")}
          </div>
          <RecyclingSalesListExport rows={exportRows} from={report.from} to={report.to}/>
        </div>
      </header>

      <div className="mx-3 mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4 md:mx-4" data-testid="recycling-sales-list-metrics">
        <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3">
          <p className="text-xs font-semibold text-blue-800">รับซื้อเข้าร้าน</p>
          <div className="mt-1 text-xl font-black tabular-nums text-blue-950">{money(total.buyMinor)} <span className="text-xs font-semibold">บาท</span></div>
          <p className="mt-1 text-xs text-blue-700">{total.buyCount.toLocaleString("th-TH")} บิลที่บันทึก</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
          <p className="text-xs font-semibold text-emerald-800">ขายออกให้ลูกค้า / โรงงาน</p>
          <div className="mt-1 text-xl font-black tabular-nums text-emerald-950">{money(total.sellMinor)} <span className="text-xs font-semibold">บาท</span></div>
          <p className="mt-1 text-xs text-emerald-700">{total.sellCount.toLocaleString("th-TH")} บิลที่บันทึก</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50/70 p-3">
          <p className="text-xs font-semibold text-rose-800">เงินสดจ่ายรับซื้อ</p>
          <div className="mt-1 text-xl font-black tabular-nums text-rose-900">−{money(total.cashOutMinor)} <span className="text-xs font-semibold">บาท</span></div>
          <p className="mt-1 text-xs text-rose-700">เงินสดจ่ายออกจริงตามบิล</p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3">
          <p className="text-xs font-semibold text-sky-800">เงินสดรับจากการขายออก</p>
          <div className="mt-1 text-xl font-black tabular-nums text-sky-950">+{money(total.cashInMinor)} <span className="text-xs font-semibold">บาท</span></div>
          <p className="mt-1 text-xs text-sky-700">ไม่รวมยอดโอน / เครดิตที่ยังไม่รับเป็นเงินสด</p>
        </div>
      </div>

      <form method="GET" action={BASE} className="mx-3 mt-3 grid grid-cols-2 items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 md:mx-4 md:grid-cols-4 xl:grid-cols-8"
        aria-label="ค้นหาและคัดกรองเอกสารรับซื้อขายออก" data-testid="recycling-sales-list-filters">
        <input type="hidden" name="direction" value={direction}/>
        <label className="col-span-2 min-w-0 text-xs font-semibold text-slate-700 md:col-span-2">
          ค้นหาเลขเอกสาร / ผู้ขาย / ผู้ซื้อ
          <input type="search" name="q" maxLength={80} defaultValue={report.q} placeholder="ค้นหาเอกสารหรือชื่อผู้ติดต่อ"
            className={"mt-1 "+field}/>
        </label>
        <label className="min-w-0 text-xs font-semibold text-slate-700">ช่วงเวลา
          <select name="period" defaultValue={report.period} className={"mt-1 "+field}>
            <option value="day">รายวัน</option><option value="month">รายเดือน</option>
            <option value="year">รายปี</option><option value="custom">กำหนดช่วง</option>
          </select>
        </label>
        <label className="min-w-0 text-xs font-semibold text-slate-700">วันที่อ้างอิง
          <input type="date" name="date" defaultValue={report.date} className={"mt-1 "+field}/>
        </label>
        <label className="min-w-0 text-xs font-semibold text-slate-700">จากวันที่
          <input type="date" name="from" defaultValue={report.from} className={"mt-1 "+field}/>
        </label>
        <label className="min-w-0 text-xs font-semibold text-slate-700">ถึงวันที่
          <input type="date" name="to" defaultValue={report.to} className={"mt-1 "+field}/>
        </label>
        <label className="min-w-0 text-xs font-semibold text-slate-700">สาขา
          <select name="branch" defaultValue={report.branch} className={"mt-1 "+field}>
            {report.branchOptions.length>1 && ["owner","manager"].includes(scope.session.role) &&
              <option value="all">ทุกสาขาที่มีสิทธิ์</option>}
            {report.branchOptions.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
        <label className="min-w-0 text-xs font-semibold text-slate-700">สถานะ
          <select name="status" defaultValue={status} className={"mt-1 "+field}>
            <option value="all">ทุกสถานะ</option><option value="posted">บันทึกแล้ว</option>
            <option value="voided">ยกเลิก (VOID)</option>
          </select>
        </label>
        <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-4 xl:col-span-8">
          <button type="submit" className="min-h-10 rounded-lg bg-blue-700 px-5 text-xs font-bold text-white hover:bg-blue-800">ค้นหา / คัดกรอง</button>
          <Link href={BASE} className={button}>ล้างตัวกรอง</Link>
          <p className="ml-auto text-xs text-slate-500">ช่วง {report.from} ถึง {report.to} · สกุลเงิน THB · ยอดบนเป็นภาพรวมทุกประเภท</p>
        </div>
      </form>

      <div className="mx-3 mt-3 min-h-[300px] min-w-0 flex-1 overflow-x-auto rounded-lg border border-slate-200 md:mx-4">
        <table className="w-full min-w-[1150px] border-collapse text-left text-xs" data-testid="recycling-sales-list-table">
          <thead className="sticky top-0 bg-slate-100 text-slate-700">
            <tr>
              {["เลขเอกสาร","วันเวลา","ประเภท","ผู้ขาย / ผู้ซื้อ","รายการวัสดุ","สาขา",
                "วิธีรับ–จ่ายเงิน","จำนวนเงิน","สถานะ","จัดการ"].map((h,i)=>
                <th key={h} className={"whitespace-nowrap px-3 py-3 font-bold "+(i===7?"text-right":"")}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {visible.length?visible.map(t=>{
              const buy=t.direction==="buy";
              const voided=t.status==="voided";
              const materials=lineCounts.get(t.id);
              return <tr key={t.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                <td className="px-3 py-3 font-mono font-semibold text-slate-800">{t.receipt_no}</td>
                <td className="whitespace-nowrap px-3 py-3 text-slate-600">{dateTime(t.created_at)}</td>
                <td className="px-3 py-3">
                  <span className={"inline-flex whitespace-nowrap rounded-md px-2 py-1 font-bold "+
                    (buy?"bg-blue-100 text-blue-800":"bg-emerald-100 text-emerald-800")}>{directions[t.direction]}</span>
                </td>
                <td className="max-w-[180px] break-words px-3 py-3 font-medium text-slate-800">
                  {t.counterparty_name&&t.counterparty_name!=="-"?t.counterparty_name:"ลูกค้าหน้าร้าน / ไม่ระบุชื่อ"}
                </td>
                <td className="max-w-[180px] px-3 py-3 text-slate-700">
                  {materials?<><span className="font-semibold">{materials.count} รายการ</span>
                    <span className="mt-1 block truncate text-slate-500" title={materials.first}>{materials.first}</span></>:"รอตรวจรายละเอียด"}
                </td>
                <td className="px-3 py-3 text-slate-600">{branchNames.get(t.branch_id)??"—"}</td>
                <td className="px-3 py-3 text-slate-700">{settlements[t.settlement]}
                  <span className="mt-1 block text-[11px] text-slate-500">{buy?"เงินจ่ายให้ผู้ขาย":"เงินรับจากผู้ซื้อ"}</span>
                </td>
                <td className={"whitespace-nowrap px-3 py-3 text-right font-extrabold tabular-nums "+
                  (voided?"text-slate-400 line-through":buy?"text-rose-700":"text-emerald-700")}>
                  {buy?"−":"+"}{money(Number(t.total_minor))} ฿
                </td>
                <td className="px-3 py-3"><span className={"inline-flex whitespace-nowrap rounded-md px-2 py-1 font-bold "+
                  (voided?"bg-rose-100 text-rose-800":"bg-slate-100 text-slate-700")}>
                  {voided?"ยกเลิก (VOID)":"บันทึกแล้ว"}</span>
                </td>
                <td className="px-3 py-3">{t.branch_id===scope.session.branch_id?
                  <RecyclingSalesListRowActions
                    receiptId={t.id} receiptNo={t.receipt_no} createdAt={t.created_at}
                    direction={t.direction} settlement={t.settlement} status={t.status}
                    amountMinor={Number(t.total_minor)}
                    canManage={["owner","manager","accountant"].includes(scope.session.role)}
                    voidEnabled={process.env.RECYCLING_VOID_ENABLED==="1"}/>:<span className="text-xs text-amber-700">เข้าสาขาต้นทางเพื่อเปิดเอกสาร</span>}
                </td>
              </tr>;
            }):<tr><td colSpan={10} className="p-16 text-center">
              <p className="font-bold text-slate-700">ไม่พบรายการรับซื้อหรือขายออกตามเงื่อนไขที่เลือก</p>
              <p className="mt-2 text-xs text-slate-500">รายการจะแสดงหลังบันทึกสำเร็จจากหน้าขาย Recycling เท่านั้น</p>
            </td></tr>}
          </tbody>
        </table>
      </div>

      <footer className="mx-3 mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3 md:mx-4">
        <p className="text-xs text-slate-500">
          พบ {filtered.length.toLocaleString("th-TH")} รายการ · หน้า {page}/{pages} ·
          ยกเลิก {total.voidCount} บิล (ไม่รวมยอดรับ–จ่ายจริง)
        </p>
        <div className="flex flex-wrap gap-2">
          {page>1&&<Link className={button} href={href({page:String(page-1)})}>ก่อนหน้า</Link>}
          {page<pages&&<Link className={button} href={href({page:String(page+1)})}>ถัดไป</Link>}
        </div>
      </footer>
      <p className="mx-3 mb-3 mt-2 text-[11px] leading-5 text-slate-500 md:mx-4">
        ระบบใช้ข้อมูลธุรกรรม Recycling ที่บันทึกแล้วเท่านั้น · ช่องทางเงินโอนเป็นประเภทตามบิล
        ไม่ถือเป็นหลักฐานธนาคารยืนยันการโอน · รายการนี้ไม่ใช่ทะเบียนบัญชีแยกประเภทหรือใบกำกับภาษี
      </p>
    </section>
  </main>;
}
