"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {FinanceOtherIncomeRegister} from "./finance-other-income-register";
import {RecyclingAmountCorrectionEditor} from "@/components/pos/recycling-amount-correction-editor";
import {RecyclingDocumentTimeEditor} from "@/components/pos/recycling-document-time-editor";
import {formatRecyclingMoney} from "@/lib/recycling-money-display";
type Row={id:string;branch_id:string;receipt_no:string;created_at:string;counterparty_name:string|null;settlement:string;base_minor:number|null;vat_minor:number|null;total_minor:number;finance_document_id:string|null};
type Report={rows:Row[];branches:{id:string;name:string}[];count:number;page:number;pageSize:number;sums:{base:number;vat:number;total:number;received:number};from:string;to:string;correctionEnabled?:boolean;amountCorrectionEnabled?:boolean};
const today=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const money=(v:number)=>formatRecyclingMoney(v/100);
const methodLabel:Record<string,string>={cash:"เงินสด",bank_transfer:"เงินโอน",credit:"เครดิต"};
const field="h-10 min-w-0 rounded border border-slate-300 bg-white px-3 text-sm";
const button="rounded border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 disabled:opacity-40";
function WholesaleRegister(){
 const [from,setFrom]=useState(()=>today().slice(0,7)+"-01"),[to,setTo]=useState(today),[branch,setBranch]=useState(""),[method,setMethod]=useState("");
 const [report,setReport]=useState<Report|null>(null),[branches,setBranches]=useState<Report["branches"]>([]),[loading,setLoading]=useState(false),[error,setError]=useState("");
 const serial=useRef(0);
 const load=useCallback(async(f:string,t:string,b:string,m:string,p:number)=>{
  const id=++serial.current;setLoading(true);setError("");setReport(null);
  try{
   const res=await fetch("/api/finance/recycling-income?"+new URLSearchParams({from:f,to:t,branchId:b,method:m,page:String(p)}),{cache:"no-store",credentials:"same-origin"});
   const body=await res.json();if(id!==serial.current)return;
   if(!res.ok||!body?.data)throw Error(body?.error?.message??"อ่านทะเบียนไม่สำเร็จ");
   setReport(body.data);setBranches(body.data.branches);
  }catch(e){if(id===serial.current)setError(e instanceof Error?e.message:"อ่านทะเบียนไม่สำเร็จ");}
  finally{if(id===serial.current)setLoading(false);}
 },[]);
 useEffect(()=>{const t=today();void load(t.slice(0,7)+"-01",t,"","",1);return()=>{serial.current++;};},[load]);
 const applied=useRef({from:today().slice(0,7)+"-01",to:today(),branch:"",method:""});
 function search(){applied.current={from,to,branch,method};void load(from,to,branch,method,1);}
 function page(n:number){const a=applied.current;void load(a.from,a.to,a.branch,a.method,n);}
 const sums=report?.sums;
 return <section className="space-y-4 p-4 md:p-5" aria-label="ทะเบียนรายรับจากการขายส่ง">
  <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-base font-extrabold text-[#164d87]">ทะเบียนรายรับจากการขายส่ง</h2><p className="mt-1 text-xs text-slate-500">ข้อมูลขายออกจาก Recycling POS โดยตรง · ไม่สร้างรายการซ้ำ</p></div><button type="button" className={button} disabled={loading} onClick={()=>page(report?.page??1)}>รีเฟรช</button></div>
  <form className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3" onSubmit={e=>{e.preventDefault();search();}}>
   <label className="grid gap-1 text-xs font-bold">จากวันที่<input className={field} required type="date" max={today()} value={from} onChange={e=>setFrom(e.target.value)}/></label>
   <label className="grid gap-1 text-xs font-bold">ถึงวันที่<input className={field} required type="date" min={from} max={today()} value={to} onChange={e=>setTo(e.target.value)}/></label>
   <label className="grid gap-1 text-xs font-bold">สาขา<select className={field} value={branch} onChange={e=>setBranch(e.target.value)}><option value="">ทุกสาขาที่ได้รับสิทธิ์</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
   <label className="grid gap-1 text-xs font-bold">ช่องทางรับเงิน<select className={field} value={method} onChange={e=>setMethod(e.target.value)}><option value="">ทั้งหมด</option>{Object.entries(methodLabel).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   <button type="submit" disabled={loading} className="rounded bg-[#1658a4] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">ค้นหา</button>
  </form>
  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
   {([["รายได้ก่อน VAT",sums?.base],["ภาษีขาย VAT",sums?.vat],["ยอดขายรวม",sums?.total],["ยอดรับตามบิล เงินสด/โอน",sums?.received]] as const).map(([label,n])=><div key={label} className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs font-semibold text-slate-600">{label}</p><p className="mt-2 text-xl font-extrabold tabular-nums text-[#1658a4]">{n===undefined?"—":money(n)} <span className="text-xs font-normal">บาท</span></p><p className="mt-1 text-xs text-slate-500">รวมเฉพาะรายการในหน้านี้</p></div>)}
  </div>
  {error&&<p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  <div className="overflow-hidden rounded-lg border border-slate-300 bg-white">
   <div className="flex flex-wrap justify-between gap-2 border-b border-slate-300 bg-[#edf3fa] p-3 text-xs"><strong>รายการขายส่ง · {report?report.from+" ถึง "+report.to:"ทะเบียนบัญชี"}</strong><span>{report?"ทั้งหมด "+report.count.toLocaleString("th-TH")+" รายการ":loading?"กำลังโหลด…":"ยังไม่ยืนยันข้อมูล"}</span></div>
   <div className="overflow-x-auto"><table className="w-full min-w-[1050px] border-collapse text-xs"><thead className="bg-[#e6eef8] text-[#244466]"><tr>{["ลำดับ","วันที่ / เวลา","เลขที่บิล","ผู้ซื้อ","สาขา","ช่องทาง","ก่อน VAT","VAT","ยอดรวม","สถานะ GL"].map((h,i)=><th key={h} scope="col" className={"border-b border-r border-slate-300 px-3 py-3 "+(i>=6&&i<=8?"text-right":"text-left")}>{h}</th>)}</tr></thead>
    <tbody>{report?.rows.map((r,i)=><tr key={r.id} className="border-b border-slate-200 even:bg-slate-50 hover:bg-blue-50"><td className="border-r border-slate-200 p-3 tabular-nums">{(report.page-1)*report.pageSize+i+1}</td><td className="border-r border-slate-200 p-3 whitespace-nowrap">{new Date(r.created_at).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</td><td className="border-r border-slate-200 p-3 font-bold text-blue-800">{r.receipt_no}</td><td className="border-r border-slate-200 p-3">{r.counterparty_name||"—"}</td><td className="border-r border-slate-200 p-3">{branches.find(b=>b.id===r.branch_id)?.name??"—"}</td><td className="border-r border-slate-200 p-3">{methodLabel[r.settlement]??r.settlement}</td><td className="border-r border-slate-200 p-3 text-right tabular-nums">{money(r.base_minor??r.total_minor)}</td><td className="border-r border-slate-200 p-3 text-right tabular-nums">{money(r.vat_minor??0)}</td><td className="border-r border-slate-200 p-3 text-right font-bold tabular-nums">{money(r.total_minor)}</td><td className="p-3">{r.finance_document_id?"เชื่อมเอกสารบัญชีแล้ว":"รอตรวจสอบ"}{report.amountCorrectionEnabled&&!r.finance_document_id&&r.settlement!=="bank_transfer"&&<div className="mt-2"><RecyclingAmountCorrectionEditor id={r.id} source="finance" onSaved={()=>page(report.page)}/></div>}{report.correctionEnabled&&!r.finance_document_id&&Number(r.vat_minor??0)===0&&<div className="mt-2"><RecyclingDocumentTimeEditor id={r.id} currentAt={r.created_at} source="finance" onSaved={()=>page(report.page)}/></div>}</td></tr>)}</tbody></table></div>
   {loading&&<p role="status" className="p-8 text-center text-sm text-slate-500">กำลังอ่านข้อมูลจริง…</p>}
   {report&&!report.rows.length&&<p className="p-10 text-center text-sm text-slate-500">ไม่พบรายการขายส่งในช่วงที่เลือก</p>}
   <footer className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 p-3 text-xs"><span>หน้า {report?.page??"—"} / {report?Math.max(1,Math.ceil(report.count/report.pageSize)):"—"}</span><div className="flex gap-2"><button type="button" className={button} disabled={loading||!report||report.page<=1} onClick={()=>page((report?.page??1)-1)}>ก่อนหน้า</button><button type="button" className={button} disabled={loading||!report||report.page*report.pageSize>=report.count||report.page>=1000} onClick={()=>page((report?.page??1)+1)}>ถัดไป</button></div></footer>
  </div>
  <p className="text-xs text-slate-500">ยอดรับตามบิลไม่ใช่ยอดกระทบยอดธนาคาร · เครดิตไม่ถือเป็นเงินรับแล้ว · รายการยกเลิกไม่รวมในทะเบียนนี้</p>
 </section>;
}
export function RecyclingFinanceIncomeWorkspace(){
 const [tab,setTab]=useState<"wholesale"|"other">("wholesale");
 return <div className="min-h-full bg-[#f4f7fb]"><div role="tablist" aria-label="ประเภทรายรับ" className="flex gap-2 border-b border-slate-300 bg-white px-5 py-3">{([["wholesale","รายรับจากการขายส่ง"],["other","รายรับอื่น ๆ"]] as const).map(([id,label])=><button key={id} type="button" role="tab" aria-selected={tab===id} onClick={()=>setTab(id)} className={"rounded-md px-4 py-2.5 text-sm font-bold "+(tab===id?"bg-[#1658a4] text-white":"border border-slate-300 text-slate-700")}>{label}</button>)}</div>{tab==="wholesale"?<WholesaleRegister/>:<FinanceOtherIncomeRegister recycling/>}</div>;
}
