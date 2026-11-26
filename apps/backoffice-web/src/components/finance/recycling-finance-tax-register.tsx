"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {formatRecyclingMoney} from "@/lib/recycling-money-display";
type Row={id:string;branchId:string;number:string;receiptNo:string;date:string;status:string;buyer:string;base:number|null;vat:number|null;total:number|null};
type Report={rows:Row[];branches:{id:string;name:string}[];count:number;page:number;pageSize:number;from:string;to:string};
type Mode="invoices"|"sales";
const today=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const money=(v:number|null)=>v===null||!Number.isSafeInteger(Number(v))?"—":formatRecyclingMoney(Number(v)/100);
const field="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm";
const btn="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 disabled:opacity-40";
export function RecyclingFinanceTaxRegister(){
 const [mode,setMode]=useState<Mode>("invoices"),[from,setFrom]=useState(()=>today().slice(0,7)+"-01"),[to,setTo]=useState(today),[branch,setBranch]=useState(""),[q,setQ]=useState("");
 const [report,setReport]=useState<Report|null>(null),[branches,setBranches]=useState<Report["branches"]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const sequence=useRef(0),applied=useRef({mode:"invoices" as Mode,from:today().slice(0,7)+"-01",to:today(),branch:"",q:""});
 const load=useCallback(async(f:typeof applied.current,page:number)=>{
  const id=++sequence.current;setBusy(true);setError("");setReport(null);
  try{const response=await fetch("/api/finance/recycling-tax?"+new URLSearchParams({mode:f.mode,from:f.from,to:f.to,branchId:f.branch,q:f.q,page:String(page)}),{credentials:"same-origin",cache:"no-store"});const body=await response.json();if(id!==sequence.current)return;if(!response.ok||!body?.data)throw Error(body?.error?.message??"โหลดทะเบียนไม่สำเร็จ");setReport(body.data);setBranches(body.data.branches);}catch(e){if(id===sequence.current)setError(e instanceof Error?e.message:"โหลดทะเบียนไม่สำเร็จ");}finally{if(id===sequence.current)setBusy(false);}
 },[]);
 useEffect(()=>{void load(applied.current,1);return()=>{sequence.current++;};},[load]);
 function search(next=mode,number=q){applied.current={mode:next,from,to,branch,q:number};void load(applied.current,1);}
 return <section className="space-y-4 bg-[#f4f7fb] p-4 md:p-5">
  <div className="flex flex-wrap items-center justify-between gap-2"><div role="group" aria-label="ประเภททะเบียนภาษี" className="flex flex-wrap gap-2">{([["invoices","ทะเบียนใบกำกับภาษี"],["sales","รายการขายที่บันทึก VAT"]] as const).map(([value,label])=><button type="button" key={value} aria-pressed={mode===value} onClick={()=>{setMode(value);setQ("");search(value,"");}} className={mode===value?"rounded-md bg-[#1658a4] px-4 py-2 text-sm font-bold text-white":btn}>{label}</button>)}</div><button type="button" disabled={busy} className={btn} onClick={()=>void load(applied.current,report?.page??1)}>รีเฟรช</button></div>
  <form className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3" onSubmit={e=>{e.preventDefault();search();}}>
   <label className="grid gap-1 text-xs font-bold">จากวันที่<input required type="date" max={today()} value={from} onChange={e=>setFrom(e.target.value)} className={field}/></label>
   <label className="grid gap-1 text-xs font-bold">ถึงวันที่<input required type="date" min={from} max={today()} value={to} onChange={e=>setTo(e.target.value)} className={field}/></label>
   <label className="grid gap-1 text-xs font-bold">สาขา<select value={branch} onChange={e=>setBranch(e.target.value)} className={field}><option value="">ทุกสาขาที่ได้รับสิทธิ์</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
   <label className="grid gap-1 text-xs font-bold">{mode==="invoices"?"เลขที่ใบกำกับภาษี":"เลขที่บิลขาย"}<input type="search" value={q} maxLength={80} onChange={e=>setQ(e.target.value)} placeholder="กรอกเลขเต็ม" className={field}/></label>
   <button type="submit" disabled={busy} className="rounded-md bg-[#1658a4] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40">ค้นหา</button>
  </form>
  {error&&<p role="alert" className="rounded border border-rose-200 bg-white p-3 text-sm text-rose-800">{error}</p>}
  <div className="overflow-hidden rounded-lg border border-slate-300 bg-white">
   <div className="flex justify-between gap-2 border-b border-slate-300 bg-[#edf3fa] p-3 text-xs"><strong>{mode==="invoices"?"ใบกำกับภาษีที่ออกจริง (รวมสถานะยกเลิก)":"รายการขายออกที่บันทึก VAT จริง"}</strong><span>{report?report.count.toLocaleString("th-TH")+" รายการ":busy?"กำลังโหลด…":"ยังไม่ยืนยันข้อมูล"}</span></div>
   <div className="overflow-x-auto"><table className="w-full min-w-[1000px] border-collapse text-xs"><thead className="bg-[#e6eef8] text-[#244466]"><tr>{["วันที่","เลขที่เอกสาร","อ้างอิงบิล","ผู้ซื้อ","สาขา","ฐานภาษี","VAT","ยอดรวม","สถานะ","เอกสาร"].map((h,i)=><th key={h} scope="col" className={"border-b border-r border-slate-300 px-3 py-3 "+(i>=5&&i<=7?"text-right":"text-left")}>{h}</th>)}</tr></thead><tbody>{report?.rows.map(r=><tr key={r.id} className="border-b border-slate-200 even:bg-slate-50 hover:bg-blue-50"><td className="border-r border-slate-200 p-3 whitespace-nowrap">{new Date(r.date).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</td><td className="border-r border-slate-200 p-3 font-bold text-blue-800">{r.number}</td><td className="border-r border-slate-200 p-3">{r.receiptNo||"—"}</td><td className="border-r border-slate-200 p-3">{r.buyer||"—"}</td><td className="border-r border-slate-200 p-3">{branches.find(b=>b.id===r.branchId)?.name??"—"}</td>{[r.base,r.vat,r.total].map((n,i)=><td key={i} className="border-r border-slate-200 p-3 text-right tabular-nums">{money(n)}</td>)}<td className="border-r border-slate-200 p-3">{mode==="sales"?"บันทึก VAT แล้ว":r.status==="issued"?"ออกแล้ว":r.status==="voided"?"ยกเลิก":r.status}</td><td className="p-3">{mode==="invoices"&&r.status==="issued"?<div className="flex gap-1">{["a4","a5","58","80"].map(p=><a key={p} className={btn} target="_blank" rel="noopener noreferrer" href={"/api/finance/recycling-tax/"+encodeURIComponent(r.id)+"?paper="+p}>{p.toUpperCase()}</a>)}</div>:"—"}</td></tr>)}</tbody></table></div>
   {report&&!report.rows.length&&<p className="p-10 text-center text-sm text-slate-500">ไม่พบเอกสารในช่วงที่เลือก</p>}
   <footer className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 p-3 text-xs"><span>หน้า {report?.page??"—"} / {report?Math.max(1,Math.ceil(report.count/report.pageSize)):"—"}</span><div className="flex gap-2"><button className={btn} disabled={busy||!report||report.page<=1} onClick={()=>void load(applied.current,(report?.page??1)-1)}>ก่อนหน้า</button><button className={btn} disabled={busy||!report||report.page*report.pageSize>=report.count||report.page>=1000} onClick={()=>void load(applied.current,(report?.page??1)+1)}>ถัดไป</button></div></footer>
  </div>
  <p className="text-xs text-slate-600">ใบกำกับภาษีและบิล VAT เป็นคนละทะเบียน ไม่รวมยอดซ้ำ · เปิดเอกสารแล้วเลือกพิมพ์ด้วย Ctrl+P · ไม่ใช่แบบยื่นภาษีสำเร็จรูป</p>
 </section>;
}
