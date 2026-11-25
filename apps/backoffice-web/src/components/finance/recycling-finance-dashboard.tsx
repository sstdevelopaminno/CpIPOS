"use client";
import {useEffect,useState,useRef} from "react";
import {formatRecyclingMoney} from "@/lib/recycling-money-display";
import {periodDates,type PeriodMode,type CapitalSnapshot,type summarizeRecyclingFinance} from "@/lib/recycling-finance-overview";
type Report={branches:{id:string;name:string}[];from:string;to:string;asOf:string;capital:CapitalSnapshot;totals:ReturnType<typeof summarizeRecyclingFinance>};
const format=(n:number|null)=>n===null?"—":formatRecyclingMoney(n/100);
const todayBangkok=()=>new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
function Metric({label,value,detail,tone="blue"}:{label:string;value:number|null;detail:string;tone?:"blue"|"green"|"red"|"slate"}){
 const colors={blue:"text-[#164f88]",green:"text-emerald-700",red:"text-rose-700",slate:"text-slate-800"};
 return <article className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
  <p className="text-sm font-semibold text-slate-700">{label}</p>
  <p className={"mt-2 break-words text-[clamp(1.15rem,2.15vw,1.8rem)] font-extrabold tabular-nums "+colors[tone]}>{format(value)} <span className="text-xs font-medium text-slate-500">บาท</span></p>
  <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
 </article>;
}
export function RecyclingFinanceDashboard({actor}:{actor:"owner"|"accountant"}){
 const [today]=useState(todayBangkok);
 const [mode,setMode]=useState<PeriodMode>("day");
 const [anchor,setAnchor]=useState(today),[from,setFrom]=useState(today),[to,setTo]=useState(today),[branchId,setBranchId]=useState("");
 const [branches,setBranches]=useState<Report["branches"]>([]);
 const [report,setReport]=useState<Report|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const serial=useRef(0);
 async function load(f:string,t:string,b:string){
  const id=++serial.current;setBusy(true);setError("");setReport(null);
  try{
   const params=new URLSearchParams({actor,from:f,to:t,branchId:b});
   const response=await fetch("/api/finance/recycling-overview?"+params,{credentials:"same-origin",cache:"no-store"});
   const body=await response.json();
   if(id!==serial.current)return;
   if(!response.ok||!body?.data)throw Error(body?.error?.message??"โหลดข้อมูลไม่สำเร็จ");
   setReport(body.data);setBranches(body.data.branches);
  }catch(e){if(id===serial.current)setError(e instanceof Error?e.message:"โหลดข้อมูลไม่สำเร็จ");}
  finally{if(id===serial.current)setBusy(false);}
 }
 useEffect(()=>{void load(today,today,"");return()=>{serial.current++;}; // initial scope only
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[actor,today]);
 function selectPeriod(next:PeriodMode,date=anchor){
  setMode(next);setAnchor(date);
  if(next!=="custom"){const p=periodDates(next,date,today);setFrom(p.from);setTo(p.to);void load(p.from,p.to,branchId);}
 }
 const t=report?.totals,c=report?.capital;
 return <section className="min-h-full w-full min-w-0 bg-[#f3f6fa] text-slate-900" data-testid="recycling-finance-dashboard">
  <header className="flex flex-wrap items-center justify-between gap-2 bg-[#155888] px-5 py-4 text-white"><div><p className="text-xs font-bold tracking-wide text-sky-100">CpiPOS FINANCE · RECYCLING</p><h1 className="mt-1 text-xl font-extrabold">ภาพรวมการเงิน</h1></div><span className="rounded border border-white/30 px-3 py-1.5 text-xs font-bold">{actor==="owner"?"เจ้าของร้าน":"ฝ่ายบัญชี"} · ข้อมูลจริง</span></header>
  <div className="space-y-5 p-3 md:p-5">
   <form className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4" onSubmit={e=>{e.preventDefault();void load(from,to,branchId);}}>
    <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="ช่วงเวลา">
     {([["day","รายวัน"],["month","รายเดือน"],["year","รายปี"],["custom","กำหนดเอง"]] as const).map(([value,label])=><button key={value} type="button" aria-pressed={mode===value} onClick={()=>selectPeriod(value)} className={"rounded-md px-3 py-2 text-sm font-bold "+(mode===value?"bg-[#155888] text-white":"text-slate-700 hover:bg-white")}>{label}</button>)}
    </div>
    {mode!=="custom"?<label className="grid gap-1 text-xs font-semibold">วันที่อ้างอิง<input type="date" required max={today} value={anchor} onChange={e=>{if(e.target.value)selectPeriod(mode,e.target.value);}} className="rounded-lg border border-slate-300 p-2 text-sm"/></label>:<>
    <label className="grid gap-1 text-xs font-semibold">จากวันที่<input type="date" required max={today} value={from} onChange={e=>setFrom(e.target.value)} className="rounded-lg border border-slate-300 p-2 text-sm"/></label>
    <label className="grid gap-1 text-xs font-semibold">ถึงวันที่<input type="date" required min={from} max={today} value={to} onChange={e=>setTo(e.target.value)} className="rounded-lg border border-slate-300 p-2 text-sm"/></label></>}
    <label className="grid gap-1 text-xs font-semibold">สาขา<select value={branchId} onChange={e=>{setBranchId(e.target.value);void load(from,to,e.target.value);}} className="min-w-[170px] rounded-lg border border-slate-300 p-2 text-sm"><option value="">ทุกสาขาที่ได้รับสิทธิ์</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
    <button type="submit" disabled={busy} className="rounded-lg bg-[#155888] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy?"กำลังโหลด…":"ค้นหา / รีเฟรช"}</button>
   </form>
   {error&&<p role="alert" className="rounded-lg border border-rose-200 bg-white p-4 text-sm text-rose-800">{error}</p>}
   <p role="status" className="text-xs text-slate-600">{busy?"กำลังอ่านข้อมูลจริง…":report?"ช่วง "+report.from+" ถึง "+report.to+" · "+report.totals.count.toLocaleString("th-TH")+" ธุรกรรมที่ยังมีผล · เวลาไทย":"ยังไม่มียอดที่ยืนยันได้"}</p>
   <section aria-label="เงินทุนหมุนเวียน"><div className="mb-3"><h2 className="text-base font-extrabold">เงินทุนหมุนเวียนและยอดซื้อ–ขาย</h2><p className="text-xs text-slate-500">ทุนเงินสดตามข้อมูลกะ ไม่รวมเงินฝากหรือทุนจดทะเบียน</p></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
     <Metric label="เงินทุนทั้งหมด" value={c?.opening??null} detail="ทุนเปิดกะแรกในช่วง / ยอดยกมาถ้าไม่มีกะ"/>
     <Metric label="เงินทุนคงเหลือ" value={c?.remaining??null} detail={c?.estimated?"ยอดคาดการณ์ตามระบบ · ยังไม่ใช่เงินนับจริง":"เงินนับจริง ณ กะล่าสุดที่มีข้อมูล"} tone="green"/>
     <Metric label="ยอดรับซื้อทั้งหมด" value={t?.buy??null} detail="ยอดบิลรับซื้อที่ยังมีผล" tone="red"/>
     <Metric label="ยอดขายออกทั้งหมด" value={t?.sell??null} detail="ยอดบิลขายออก รวม VAT ถ้ามี" tone="green"/>
    </div>
   </section>
   <section aria-label="สรุปบัญชี"><div className="mb-3"><h2 className="text-base font-extrabold">ภาพรวมบัญชีและกระแสเงิน</h2><p className="text-xs text-slate-500">เฉพาะข้อมูลต้นทาง Recycling · ยังไม่ใช่งบกำไรขาดทุนสุทธิจาก GL</p></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
     <Metric label="รายรับจากการขาย" value={t?.revenue??null} detail="รายได้ขายวัสดุก่อน VAT" tone="green"/>
     <Metric label="รายจ่าย (ต้นทุนขาย)" value={t?.cogs??null} detail="ต้นทุนสินค้าที่ขายแล้ว ไม่รวมค่าใช้จ่ายอื่น" tone="red"/>
     <Metric label="กำไรขั้นต้น" value={t?.profit??null} detail="รายได้ก่อน VAT − ต้นทุนขาย (ส่วนบวก)" tone="green"/>
     <Metric label="ขาดทุนขั้นต้น" value={t?.loss??null} detail="ต้นทุนขายส่วนที่สูงกว่ารายได้" tone="red"/>
     <Metric label="กระแสเงินสดสุทธิ" value={t?.cashNet??null} detail={t?"รับ "+format(t.cashIn)+" · จ่าย "+format(t.cashOut):"เงินสดเข้า − เงินสดออก"} tone="slate"/>
     <Metric label="กระแสเงินโอนสุทธิ" value={t?.bankNet??null} detail={t?"รับ "+format(t.bankIn)+" · จ่าย "+format(t.bankOut):"เงินโอนเข้า − เงินโอนออก"} tone="slate"/>
    </div>
   </section>
   <p className="rounded-lg border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">เงินทุนเป็นยอดจากกะของแต่ละสาขา ไม่บวกยอดเปิดกะซ้ำในรายเดือน/ปี ไม่รวม VAT เป็นรายได้ ไม่รวมยอดเครดิตในกระแสเงิน และยังไม่รวมค่าใช้จ่ายนอก POS หรือยอดธนาคารจริง หากข้อมูลกะไม่ครบจะแสดง — แทนการสมมติยอดเงิน</p>
  </div>
 </section>;
}
