"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { currencyToMinor, type FinanceCurrency } from "@/lib/finance-accounting-core";
import { FinanceDialog } from "./finance-dialog";

type Module = "sales-receivables" | "purchases-payables" | "expenses" | "ledger" | "banking";
type Branch = { id:string; name:string; code:string };
type Account = { id:string; code:string; name:string; type:"asset"|"liability"|"equity"|"income"|"expense" };
type Document = {
 id:string; branchId:string; kind:string; number:string; status:string; version:number;
 amountMinor:number; currency:FinanceCurrency; party:string; date:string; dueDate:string|null;
 preparedBy:string; approvedBy:string|null; postedJournalId:string|null;
 sourceDocumentId:string|null;
};
type DocumentDetail = {
 lines:Array<{no:number;description:string;quantity:number;unitMinor:number;totalMinor:number}>;
 events:Array<{action:string;previous:string;current:string;timestamp:string;actorId:string}>;
};
type AgingRecord = { id:string;currency:FinanceCurrency;dueDate:string;originalMinor:number;appliedMinor:number };
type AgingBucket = { currency:FinanceCurrency; currentMinor:number; days1to30Minor:number;
 days31to60Minor:number; days61to90Minor:number; over90Minor:number; totalMinor:number };
type ApiEnvelope<T> = { data:T|null; error:{code:string;message:string}|null };
const path="/api/finance/accounting";
const kinds:Record<Exclude<Module,"ledger">,Array<{value:string;label:string}>>={
 "sales-receivables":[
  {value:"sales_quote",label:"ใบเสนอราคา"},
  {value:"sales_order",label:"ใบสั่งขาย"},
  {value:"delivery_note",label:"ใบส่งของ"},
  {value:"sales_invoice",label:"ใบแจ้งหนี้"},
  {value:"receipt_voucher",label:"ใบสำคัญรับเงิน / รับชำระลูกหนี้"}
 ],
 "purchases-payables":[
  {value:"purchase_request",label:"ใบขอซื้อ"},
  {value:"purchase_order",label:"ใบสั่งซื้อ"},
  {value:"goods_receipt",label:"บันทึกรับสินค้า"},
  {value:"supplier_bill",label:"ใบแจ้งหนี้ผู้ขาย"},
  {value:"payment_voucher",label:"ใบสำคัญจ่าย / จ่ายชำระเจ้าหนี้"}
 ],
 expenses:[{value:"expense_voucher",label:"ค่าใช้จ่าย / ใบสำคัญจ่าย"}],
 banking:[{value:"bank_transfer",label:"รายการโอนระหว่างบัญชี"}]
};
const sourceKinds:Record<string,string[]>={
  sales_order:["sales_quote"],
  delivery_note:["sales_order"],
  sales_invoice:["delivery_note","sales_order"],
  purchase_order:["purchase_request"],
  goods_receipt:["purchase_order"],
  supplier_bill:["goods_receipt","purchase_order"],
  receipt_voucher:["sales_invoice"],
  payment_voucher:["supplier_bill"]
};
const statusThai:Record<string,string>={
 draft:"แบบร่าง",submitted:"รออนุมัติ",approved:"อนุมัติแล้ว",
 issued:"ออกเอกสารแล้ว",rejected:"ส่งกลับแก้ไข",voided:"ยกเลิกแล้ว"
};
const errThai:Record<string,string>={
 finance_accounting_not_enabled:"ระบบทะเบียนบัญชียังไม่เปิดใช้ใน Production จนกว่าจะตรวจสอบฐานข้อมูลและสิทธิ์ครบ",
 finance_accounting_schema_unavailable:"ยังไม่มีตารางบัญชีในฐานข้อมูลที่เชื่อมอยู่",
 finance_accounting_self_approval_forbidden:"ผู้จัดทำไม่สามารถอนุมัติเอกสารของตนเองได้",
 finance_accounting_version_conflict:"เอกสารเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลใหม่",
 finance_accounting_duplicate:"เลขที่เอกสารหรือรหัสคำขอซ้ำ",
 finance_accounting_overallocation:"ยอดรับหรือจ่ายเกินกว่ายอดค้างชำระ",
 finance_accounting_posting_not_approved:"ต้องอนุมัติและออกเอกสารก่อนลงบัญชี",
 finance_accounting_period_locked:"งวดบัญชีถูกล็อก",
 finance_accounting_account_type_invalid:"ประเภทบัญชีเดบิต/เครดิตไม่ตรงกับเอกสาร",
 finance_accounting_account_not_found:"ไม่พบผังบัญชีที่เลือก"
};
const money=(minor:number,currency:FinanceCurrency)=>new Intl.NumberFormat("th-TH",{
 minimumFractionDigits:currency==="LAK"?0:2,maximumFractionDigits:currency==="LAK"?0:2
}).format(minor/(currency==="LAK"?1:100));
function today(){return new Intl.DateTimeFormat("en-CA",{
 timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"
}).format(new Date());}
async function api<T>(endpoint:string,init?:RequestInit):Promise<T>{
 const response=await fetch(endpoint,{...init,cache:"no-store"});
 const payload=(await response.json().catch(()=>null)) as ApiEnvelope<T>|null;
 if(!response.ok||payload?.error||!payload?.data) {
  const code=payload?.error?.code??"finance_accounting_unavailable";
  throw new Error(errThai[code]??code);
 }
 return payload.data;
}
const field="h-10 w-full min-w-0 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100";
const label="mb-1 block text-xs font-semibold text-slate-600";
const primary="rounded-md bg-blue-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-45";
const outline="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40";
type LineInput = {description:string;quantity:string;unit:string};
function inputLine():LineInput{return {description:"",quantity:"1",unit:"0"};}

export function FinanceAccountingRegister({module,recyclingExpenses=false}:{module:Module;recyclingExpenses?:boolean}) {
 const [enabled,setEnabled]=useState(true);
 const [error,setError]=useState<string|null>(null);
 const [notice,setNotice]=useState<string|null>(null);
 const [loading,setLoading]=useState(false);
 const [branches,setBranches]=useState<Branch[]>([]);
 const [branch,setBranch]=useState("");
 const [kind,setKind]=useState(module==="ledger"?"":kinds[module][0].value);
 const [docs,setDocs]=useState<Document[]>([]);
 const [accounts,setAccounts]=useState<Account[]>([]);
 const [aging,setAging]=useState<AgingBucket[]>([]);
 const [openDebts,setOpenDebts]=useState<AgingRecord[]>([]);
 const [selected,setSelected]=useState<Document|null>(null);
 const [selectedDetail,setSelectedDetail]=useState<DocumentDetail|null>(null);
 const [detailLoading,setDetailLoading]=useState(false);
 const [createOpen,setCreateOpen]=useState(false);
 const [accountOpen,setAccountOpen]=useState(false);
 const [busy,setBusy]=useState(false);
 const [number,setNumber]=useState("");
 const [party,setParty]=useState("");
 const [date,setDate]=useState(today);
 const [due,setDue]=useState("");
 const [currency,setCurrency]=useState<FinanceCurrency>("THB");
 const [lines,setLines]=useState<LineInput[]>([inputLine()]);
 const [requestKey,setRequestKey]=useState("");
 const [sourceDocumentId,setSourceDocumentId]=useState("");
 const [evidenceRef,setEvidenceRef]=useState("");
 const [evidenceType,setEvidenceType]=useState<"cash_count"|"bank_transfer"|"cheque"|"card">("bank_transfer");
 const [sources,setSources]=useState<Document[]>([]);
 const [reason,setReason]=useState("");
 const [debit,setDebit]=useState("");
 const [credit,setCredit]=useState("");
 const [code,setCode]=useState("");
 const [accountName,setAccountName]=useState("");
 const [accountType,setAccountType]=useState<Account["type"]>("asset");
 const options=module==="ledger"?[]:kinds[module];
 const side=module==="sales-receivables"?"AR":module==="purchases-payables"?"AP":null;
 const settlement=kind==="receipt_voucher"||kind==="payment_voucher";
 const availableSourceKinds=sourceKinds[kind]??[];
 const canLinkSource=availableSourceKinds.length>0;
 const evidenceNeeded=settlement||kind==="expense_voucher"||kind==="bank_transfer";

 const refresh=useCallback(async()=>{
  setLoading(true);setError(null);
  try {
   const list=await api<{branches:Branch[]}>(path+"?view=branches");
   setBranches(list.branches);
   const activeBranch=branch&&list.branches.some(x=>x.id===branch)?branch:list.branches[0]?.id??"";
   if(!branch&&activeBranch)setBranch(activeBranch);
   if(module==="ledger"){
    const result=await api<{accounts:Account[]}>(path+"?view=accounts");
    setAccounts(result.accounts);setDocs([]);setAging([]);setOpenDebts([]);
   } else {
    const result=await api<{documents:Document[]}>(path+"?view=documents&kind="+
      encodeURIComponent(kind)+(activeBranch?"&branchId="+encodeURIComponent(activeBranch):""));
    setDocs(result.documents);
    if(side&&activeBranch) {
      const debt=await api<{buckets:AgingBucket[];documents:AgingRecord[]}>(path+"?view=aging&side="+side+
        "&branchId="+encodeURIComponent(activeBranch)+"&asOf="+today());
      setAging(debt.buckets);
      setOpenDebts(debt.documents);
    }
   }
   setEnabled(true);
  } catch(e) {
   const message=e instanceof Error?e.message:"เกิดข้อผิดพลาด";
   if(message===errThai.finance_accounting_not_enabled||
     message===errThai.finance_accounting_schema_unavailable)setEnabled(false);
   setError(message);setDocs([]);setAging([]);setOpenDebts([]);
  } finally {setLoading(false);}
 },[module,kind,branch,side]);
 useEffect(()=>{void refresh();},[refresh]);

 const sum=useMemo(()=>{
  try{return lines.reduce((total,item)=>total+Math.round(Number(item.quantity)*
    currencyToMinor(Number(item.unit),currency)),0);}
  catch{return NaN;}
 },[lines,currency]);
 const submit=async(body:Record<string,unknown>)=>{
  setBusy(true);setError(null);setNotice(null);
  try{
   await api<unknown>(path,{method:"POST",headers:{"Content-Type":"application/json"},
     body:JSON.stringify(body)});
   setNotice("บันทึกสำเร็จ ระบบไม่สร้างรายการ POS ซ้ำ");
   setCreateOpen(false);setAccountOpen(false);setSelected(null);
   await refresh();
  }catch(e){setError(e instanceof Error?e.message:"ไม่สามารถดำเนินการได้");}
  finally{setBusy(false);}
 };
 function openCreate(){
  setRequestKey(crypto.randomUUID());setNumber("");setParty("");setDue("");
  setDate(today());setCurrency("THB");setLines([inputLine()]);
  setEvidenceRef("");setEvidenceType("bank_transfer");
  setSourceDocumentId("");setError(null);setCreateOpen(true);
 }
 async function createDocument(){
  if(!branch||!Number.isSafeInteger(sum)||sum<=0){setError("กรุณาตรวจสอบสาขา รายการ และจำนวนเงิน");return;}
  if(["sales_invoice","supplier_bill"].includes(kind)&&!due){
    setError("ใบแจ้งหนี้ต้องระบุวันครบกำหนดชำระ");return;
  }
  if(evidenceNeeded&&evidenceRef.trim().length<8){
    setError("กรุณาระบุเลขอ้างอิงหลักฐานการรับหรือจ่ายเงินอย่างน้อย 8 ตัวอักษร");return;
  }
  const mapped=lines.map(row=>{
   const quantity=Number(row.quantity),unitMinor=currencyToMinor(Number(row.unit),currency);
   return {description:row.description.trim(),quantity,unitMinor,
    lineMinor:Math.round(quantity*unitMinor)};
  });
  await submit({
   action:"create_document",branchId:branch,kind,documentNo:number,counterparty:party,
   documentDate:date,dueDate:due,currency,lines:mapped,requestKey,
   sourceDocumentId:canLinkSource&&sourceDocumentId?sourceDocumentId:null,
   evidenceRef:evidenceNeeded?evidenceRef:null,evidenceType:evidenceNeeded?evidenceType:null
  });
 }
 async function transition(action:string){
  if(!selected)return;
  await submit({action:"transition_document",documentId:selected.id,version:selected.version,
    transition:action,reason});
 }
 async function post(){
  if(!selected||!debit||!credit){setError("กรุณาเลือกบัญชีเดบิตและเครดิตจากผังบัญชี");return;}
  await submit({action:"post_document",documentId:selected.id,debitAccountId:debit,creditAccountId:credit});
 }
 async function openDocument(row:Document){
  setError("");setSelected(row);setSelectedDetail(null);setDetailLoading(true);
  setDebit("");setCredit("");setReason("");
  void loadAccounts();
  try{
   const value=await api<DocumentDetail & {document:Document}>(
     path+"?view=document_detail&documentId="+encodeURIComponent(row.id));
   setSelectedDetail({lines:value.lines,events:value.events});
  }catch(e){setError(e instanceof Error?e.message:"ไม่สามารถโหลดรายละเอียดเอกสาร");}
  finally{setDetailLoading(false);}
 }
 async function loadAccounts(){
  try{const x=await api<{accounts:Account[]}>(path+"?view=accounts");setAccounts(x.accounts);}
  catch(e){setError(e instanceof Error?e.message:"ไม่สามารถโหลดผังบัญชี");}
 }
 useEffect(()=>{
  if(!sourceKinds[kind]||!createOpen||!branch)return;
  let ignore=false;
  void Promise.all(sourceKinds[kind].map(source=>
    api<{documents:Document[]}>(path+"?view=documents&kind="+source+
      "&branchId="+encodeURIComponent(branch))
  )).then(groups=>{
    if(ignore)return;
    setSources(groups.flatMap(result=>result.documents).filter(d=>
      d.status==="issued" && d.currency===currency &&
      (!settlement || Boolean(d.postedJournalId))));
  }).catch(()=>{if(!ignore)setSources([]);});
  return()=>{ignore=true};
 },[kind,createOpen,branch,currency,settlement]);
 const monthNote=module==="ledger"?"ผังบัญชีสำหรับลงรายการเดบิต–เครดิตจากเอกสารที่ผ่านการอนุมัติ โดยไม่สร้างยอดบัญชีสมมติ":
  module==="banking"?"บันทึกการโอนโดยมีหลักฐานและผู้อนุมัติ ก่อนเลือกบัญชีเดบิตและเครดิตจริง":
  "จัดการทะเบียนเอกสารและผู้อนุมัติอย่างเป็นขั้นตอน ไม่สร้างยอดขาย POS หรือใบกำกับภาษีซ้ำ";
 const canPost=selected?.status==="issued"&&!selected.postedJournalId&&
  ["sales_invoice","supplier_bill","expense_voucher","receipt_voucher","payment_voucher","bank_transfer"].includes(selected.kind);
 return (
  <div className="w-full min-w-0 border-b border-slate-200 bg-white">
   <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-3">
    <div className="min-w-0">
     <h2 className="text-sm font-bold text-slate-800">{module==="ledger"?"ผังบัญชี":module==="banking"?"ทะเบียนโอนเงินระหว่างบัญชี" :recyclingExpenses?"ทะเบียนรายจ่ายอื่น ๆ":"ทะเบียนเอกสารธุรกิจ"}</h2>
     <p className="mt-1 text-xs leading-5 text-slate-500">{monthNote}</p>
    </div>
    <div className="flex flex-wrap gap-2">
     <button className={outline} disabled={loading} onClick={()=>void refresh()}>โหลดใหม่</button>
     {module==="ledger"
      ?<button className={primary} disabled={!enabled} onClick={()=>setAccountOpen(true)}>เพิ่มบัญชี</button>
      :<button className={primary} disabled={!enabled||!branch} onClick={openCreate}>{module==="expenses"?"+ เพิ่มรายจ่ายอื่น ๆ":module==="banking"?"+ เพิ่มรายการโอน":"+ เพิ่มเอกสาร"}</button>}
    </div>
   </div>
   {error&&<p role="alert" className="mx-5 my-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">{error}</p>}
   {notice&&<p role="status" className="mx-5 my-3 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">{notice}</p>}
   <div className="flex flex-wrap gap-3 px-5 py-4">
    <div className="min-w-[180px] flex-1">
     <label className={label} htmlFor="finance-register-branch">สาขา</label>
     <select className={field} id="finance-register-branch" value={branch} onChange={e=>setBranch(e.target.value)}>
      {branches.length===0?<option value="">ไม่มีข้อมูลสาขา</option>:null}
      {branches.map(b=><option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
     </select>
    </div>
    {module!=="ledger"&&<div className="min-w-[190px] flex-1">
     <label className={label} htmlFor="finance-register-kind">ประเภทเอกสาร</label>
     <select id="finance-register-kind" className={field} value={kind} onChange={e=>{setKind(e.target.value);setSourceDocumentId("");setEvidenceType("bank_transfer");}}>
      {options.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}
     </select>
    </div>}
   </div>

   {module==="ledger"?
    <div className="overflow-x-auto border-t border-slate-200">
     <table className="w-full min-w-[600px] text-sm"><thead className="bg-slate-100 text-xs text-slate-600">
      <tr><th className="px-5 py-3 text-left">รหัสบัญชี</th><th className="px-5 py-3 text-left">ชื่อบัญชี</th>
      <th className="px-5 py-3 text-left">หมวด</th></tr></thead>
      <tbody>{accounts.map(a=><tr key={a.id} className="border-t border-slate-100">
       <td className="px-5 py-3 font-semibold">{a.code}</td><td className="px-5 py-3">{a.name}</td>
       <td className="px-5 py-3">{a.type}</td>
      </tr>)}</tbody></table>
     {accounts.length===0&&<p className="px-5 py-5 text-sm text-slate-500">ยังไม่มีผังบัญชีที่ยืนยันแล้ว</p>}
    </div>
    :<>
    {side&&aging.length>0&&<div className="grid gap-px border-y border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-5">
     {aging.flatMap(a=>[
      {key:a.currency+"-current",caption:"ยังไม่ถึงกำหนด",val:a.currentMinor,c:a.currency},
      {key:a.currency+"-1-30",caption:"เกิน 1–30 วัน",val:a.days1to30Minor,c:a.currency},
      {key:a.currency+"-31-60",caption:"เกิน 31–60 วัน",val:a.days31to60Minor,c:a.currency},
      {key:a.currency+"-61-90",caption:"เกิน 61–90 วัน",val:a.days61to90Minor,c:a.currency},
      {key:a.currency+"-90plus",caption:"เกิน 90 วัน",val:a.over90Minor,c:a.currency}
     ]).map(a=><div key={a.key} className="bg-white px-5 py-4">
      <p className="text-xs text-slate-500">{a.caption} ({a.c})</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-slate-800">{money(a.val,a.c)}</p>
     </div>)}
    </div>}
    <div className="overflow-x-auto">
     <table className={"w-full min-w-[950px] text-sm "+(recyclingExpenses?"border-collapse [&_th]:border-r [&_td]:border-r [&_th]:border-slate-300 [&_td]:border-slate-200 [&_tbody_tr:nth-child(even)]:bg-slate-50":"")}>
      <thead className="border-b border-slate-200 bg-slate-100 text-xs text-slate-600">
       <tr><th className="px-5 py-3 text-left">เลขที่เอกสาร</th>
       <th className="px-5 py-3 text-left">คู่ค้า</th><th className="px-5 py-3 text-left">วันที่</th>
       <th className="px-5 py-3 text-left">ครบกำหนด</th>
       <th className="px-5 py-3 text-right">จำนวนเงิน</th><th className="px-5 py-3 text-right">คงค้าง</th><th className="px-5 py-3 text-left">สถานะ</th>
       <th className="px-5 py-3 text-right">รายละเอียด</th>{recyclingExpenses&&<th className="px-5 py-3 text-left">ใบสำคัญจ่าย</th>}</tr>
      </thead>
      <tbody>{docs.map(d=><tr key={d.id} className="border-b border-slate-100">
       <td className="px-5 py-3 font-semibold text-blue-800">{d.number}</td>
       <td className="px-5 py-3">{d.party}</td>
       <td className="px-5 py-3 tabular-nums">{d.date}</td>
       <td className="px-5 py-3 tabular-nums">{d.dueDate??"-"}</td>
       <td className="px-5 py-3 text-right tabular-nums">{money(d.amountMinor,d.currency)} {d.currency}</td>
       <td className="px-5 py-3 text-right tabular-nums">{
         openDebts.find(value=>value.id===d.id)
           ? money((openDebts.find(value=>value.id===d.id)?.originalMinor??0)-
               (openDebts.find(value=>value.id===d.id)?.appliedMinor??0),d.currency)
           : "-"
       }</td>
       <td className="px-5 py-3">{statusThai[d.status]??d.status}{d.postedJournalId?" · ลงบัญชีแล้ว":""}</td>
       <td className="px-5 py-3 text-right"><button className={outline}
        onClick={()=>void openDocument(d)}>ดู / ดำเนินการ</button></td>
       {recyclingExpenses&&<td className="px-3 py-2">{d.status==="issued"&&d.kind==="expense_voucher"?<div className="flex flex-wrap gap-1">{(["A4","A5"] as const).map(size=><a key={size} className={outline} target="_blank" rel="noopener noreferrer" href={"/api/finance/expense-voucher/"+encodeURIComponent(d.id)+"?size="+size}>ใบสำคัญจ่าย {size}</a>)}</div>:<span className="text-xs text-slate-500">รอออกเอกสาร</span>}</td>}
      </tr>)}</tbody>
     </table>
     {docs.length===0&&!loading&&<p className="px-5 py-6 text-sm text-slate-500">ยังไม่มีเอกสารในหมวดนี้ ไม่สร้างยอดสมมติ</p>}
     {loading&&<p className="px-5 py-4 text-sm text-slate-500">กำลังตรวจข้อมูล...</p>}
    </div>
   </>}
   <FinanceDialog open={createOpen} title={`สร้าง ${options.find(x=>x.value===kind)?.label??"เอกสาร"}`}
     description="เอกสารแบบร่างต้องผ่านผู้อนุมัติก่อนออกและลงบัญชี"
     busy={busy} onClose={()=>{setCreateOpen(false);setError("");}}>
     <div className="space-y-4">
      <p className="mb-4 text-xs leading-6 text-slate-600">สร้างแบบร่างก่อน ต้องมีผู้ตรวจสอบอีกคนอนุมัติ เอกสารนี้ไม่สร้างบิล POS หรือภาษีใหม่</p>
      <div className="grid gap-3 sm:grid-cols-2">
       <div><label className={label}>เลขที่เอกสาร</label><input className={field} value={number} onChange={e=>setNumber(e.target.value)} maxLength={64} placeholder="เลขที่ตามทะเบียนของร้าน"/></div>
       <div><label className={label}>{recyclingExpenses?"ผู้รับเงิน":"คู่ค้า / ลูกค้า"}</label><input className={field} value={party} onChange={e=>setParty(e.target.value)} maxLength={240} placeholder="ชื่อที่ได้รับการยืนยัน"/></div>
       <div><label className={label}>วันที่เอกสาร</label><input className={field} type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
       <div><label className={label}>ครบกำหนดชำระ</label><input className={field} type="date" value={due} onChange={e=>setDue(e.target.value)}/></div>
       <div><label className={label}>สกุลเงิน</label><select className={field} value={currency} onChange={e=>setCurrency(e.target.value as FinanceCurrency)}>
        <option>THB</option><option>LAK</option><option>USD</option></select></div>
       {evidenceNeeded&&<div><label className={label}>หลักฐานการรับ/จ่ายเงิน</label>
        <select className={field} value={evidenceType} disabled={kind==="bank_transfer"} onChange={e=>setEvidenceType(e.target.value as typeof evidenceType)}>
         <option value="bank_transfer">โอนเงินพร้อมหลักฐาน</option>
         <option value="cash_count">เงินสด / ใบนับเงิน</option>
         <option value="cheque">เช็ค</option>
         <option value="card">บัตร / หลักฐานผู้ให้บริการ</option>
        </select>
       </div>}
       {evidenceNeeded&&<div><label className={label}>เลขอ้างอิงหลักฐาน (8–120 ตัวอักษร)</label>
        <input className={field} value={evidenceRef} maxLength={120}
          onChange={e=>setEvidenceRef(e.target.value)}
          placeholder="เช่น TRANSFER-20261118-001"/>
       </div>}
       {canLinkSource&&<div><label className={label}>{settlement?"เอกสารลูกหนี้/เจ้าหนี้ต้นทาง (ต้องลงบัญชีแล้ว)":"เอกสารต้นทางที่เชื่อมโยง (ถ้ามี)"}</label>
        <select className={field} value={sourceDocumentId} onChange={e=>setSourceDocumentId(e.target.value)}>
         <option value="">{settlement?"เลือกเอกสาร":"ไม่ผูกเอกสารต้นทาง"}</option>
         {sources.map(x=><option key={x.id} value={x.id}>{x.number} — {money(x.amountMinor,x.currency)} {x.currency}</option>)}
        </select></div>}
      </div>
      <div className="mt-5 border-t border-slate-200 pt-4">
       <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-slate-800">รายการเอกสาร</h4>
        <button className={outline} onClick={()=>setLines(x=>[...x,inputLine()])} disabled={busy||lines.length>=100}>เพิ่มแถว</button>
       </div>
       <div className="space-y-3">
        {lines.map((row,i)=><div key={i} className="grid items-end gap-2 border-b border-slate-100 pb-3 sm:grid-cols-[minmax(0,1fr)_85px_125px_54px]">
         <div><label className={label}>รายการ {i+1}</label><input className={field} value={row.description}
          onChange={e=>setLines(x=>x.map((a,j)=>j===i?{...a,description:e.target.value}:a))} maxLength={500}/></div>
         <div><label className={label}>จำนวน</label><input className={field} inputMode="decimal" value={row.quantity}
          onChange={e=>setLines(x=>x.map((a,j)=>j===i?{...a,quantity:e.target.value}:a))}/></div>
         <div><label className={label}>ราคาต่อหน่วย</label><input className={field} inputMode="decimal" value={row.unit}
          onChange={e=>setLines(x=>x.map((a,j)=>j===i?{...a,unit:e.target.value}:a))}/></div>
         <button className={outline} disabled={busy||lines.length===1} onClick={()=>setLines(x=>x.filter((_,j)=>j!==i))}>ลบ</button>
        </div>)}
       </div>
       <p className="mt-3 text-right text-base font-bold text-slate-800">รวม {Number.isFinite(sum)?money(sum,currency):"—"} {currency}</p>
      </div>
      {error&&<p role="alert" className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-800">{error}</p>}
     </div>
     <footer className="mt-5 flex justify-end gap-2 border-t border-slate-200 pt-4">
      <button className={outline} disabled={busy} onClick={()=>setCreateOpen(false)}>ยกเลิก</button>
      <button className={primary} disabled={busy||!number.trim()||!party.trim()||!Number.isFinite(sum)||sum<=0||settlement&&!sourceDocumentId||evidenceNeeded&&evidenceRef.trim().length<8}
       onClick={()=>void createDocument()}>{busy?"กำลังบันทึก...":"บันทึกแบบร่าง"}</button>
     </footer>

   </FinanceDialog>
   {selected&&<FinanceDialog open={Boolean(selected)}
     title={selected.number}
     description={`${statusThai[selected.status]??selected.status} · Version ${selected.version}`}
     busy={busy} onClose={()=>{setSelected(null);setSelectedDetail(null);setError("");}}>
     <div className="space-y-3 text-sm">
      <p>{recyclingExpenses?"ผู้รับเงิน":"คู่ค้า"}: <b>{selected.party}</b></p><p>ยอดเงิน: <b>{money(selected.amountMinor,selected.currency)} {selected.currency}</b></p>
      {detailLoading&&<p className="text-xs text-slate-500">กำลังอ่านรายละเอียดจากทะเบียน...</p>}
      {selectedDetail&&<div className="overflow-x-auto border border-slate-200">
       <div className="border-b border-slate-200 bg-slate-100 px-3 py-2 text-xs font-bold">รายการในเอกสาร</div>
       <table className="w-full min-w-[440px] text-xs">
        <thead className="bg-slate-50"><tr>
         <th className="px-3 py-2 text-left">รายละเอียด</th><th className="px-3 py-2 text-right">จำนวน</th>
         <th className="px-3 py-2 text-right">ราคาต่อหน่วย</th><th className="px-3 py-2 text-right">รวม</th>
        </tr></thead><tbody>{selectedDetail.lines.map(line=><tr key={line.no} className="border-t border-slate-100">
         <td className="px-3 py-2">{line.description}</td><td className="px-3 py-2 text-right">{line.quantity}</td>
         <td className="px-3 py-2 text-right">{money(line.unitMinor,selected.currency)}</td>
         <td className="px-3 py-2 text-right">{money(line.totalMinor,selected.currency)}</td>
        </tr>)}</tbody></table>
      </div>}
      {selectedDetail&&selectedDetail.events.length>0&&<div className="border border-slate-200">
       <div className="border-b border-slate-200 bg-slate-100 px-3 py-2 text-xs font-bold">ประวัติการดำเนินการ</div>
       <div className="max-h-32 overflow-y-auto">{selectedDetail.events.map((event,index)=>
         <p key={index} className="border-b border-slate-100 px-3 py-2 text-xs text-slate-600">
          {event.timestamp} · {event.action} · {event.current}
         </p>)}</div>
      </div>}
      <p className="text-xs text-slate-600">ผู้อนุมัติถูกตรวจจากบัญชีผู้ใช้งานจริง และต้องไม่เป็นผู้จัดทำคนเดียวกัน</p>
      {selected.status==="issued"&&selected.postedJournalId&&<p className="rounded bg-slate-100 px-3 py-2 text-xs text-slate-700">ลงบัญชีแล้ว รหัส Journal: {selected.postedJournalId}</p>}
      {selected.status==="issued"&&!selected.postedJournalId&&<div className="grid gap-3 sm:grid-cols-2">
       <div><label className={label}>บัญชีเดบิต</label><select className={field} value={debit} onChange={e=>setDebit(e.target.value)}>
        <option value="">เลือกผังบัญชี</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code} {a.name} ({a.type})</option>)}</select></div>
       <div><label className={label}>บัญชีเครดิต</label><select className={field} value={credit} onChange={e=>setCredit(e.target.value)}>
        <option value="">เลือกผังบัญชี</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code} {a.name} ({a.type})</option>)}</select></div>
      </div>}
      {selected.status==="issued"&&!selected.postedJournalId&&<div><label className={label}>เหตุผลยกเลิก (ขั้นต่ำ 10 ตัวอักษร)</label>
       <input className={field} value={reason} onChange={e=>setReason(e.target.value)}/></div>}
      {error&&<p role="alert" className="rounded bg-amber-50 px-3 py-2 text-amber-800">{error}</p>}
     </div>
     <footer className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
      {(selected.status==="draft"||selected.status==="rejected")&&<button className={primary} disabled={busy}
       onClick={()=>void transition("submit")}>ส่งอนุมัติ</button>}
      {selected.status==="submitted"&&<>
       <button className={outline} disabled={busy} onClick={()=>void transition("reject")}>ส่งกลับ</button>
       <button className={primary} disabled={busy} onClick={()=>void transition("approve")}>อนุมัติ</button>
      </>}
      {selected.status==="approved"&&<button className={primary} disabled={busy} onClick={()=>void transition("issue")}>{recyclingExpenses?"ออกใบสำคัญจ่าย":"ออกเอกสาร"}</button>}
      {canPost&&<button className={primary} disabled={busy||!debit||!credit} onClick={()=>void post()}>ลงบัญชีเดบิต/เครดิต</button>}
      {selected.status==="issued"&&!selected.postedJournalId&&
       <button className={outline} disabled={busy||reason.trim().length<10} onClick={()=>void transition("void")}>ยกเลิกเอกสาร</button>}
     </footer>

   </FinanceDialog>}
   <FinanceDialog open={accountOpen} title="เพิ่มผังบัญชี"
     description="ระบุรหัสบัญชีและประเภทบัญชีตามที่ได้รับอนุมัติ"
     busy={busy} onClose={()=>{setAccountOpen(false);setError("");}}>
     <div className="space-y-4">
      <div><label className={label}>รหัสบัญชี</label><input className={field} value={code} maxLength={32} onChange={e=>setCode(e.target.value)}/></div>
      <div><label className={label}>ชื่อบัญชี</label><input className={field} value={accountName} maxLength={160} onChange={e=>setAccountName(e.target.value)}/></div>
      <div><label className={label}>ประเภทบัญชี</label><select className={field} value={accountType} onChange={e=>setAccountType(e.target.value as Account["type"])}>
       <option value="asset">สินทรัพย์</option><option value="liability">หนี้สิน</option>
       <option value="equity">ส่วนของเจ้าของ</option><option value="income">รายได้</option><option value="expense">ค่าใช้จ่าย</option>
      </select></div>
      {error&&<p role="alert" className="rounded bg-amber-50 px-3 py-2 text-sm">{error}</p>}
     </div>
     <footer className="mt-5 flex justify-end gap-2 border-t border-slate-200 pt-4">
      <button className={outline} onClick={()=>setAccountOpen(false)}>ยกเลิก</button>
      <button className={primary} disabled={busy||!branch||!code.trim()||!accountName.trim()} onClick={()=>void submit({
       action:"create_account",branchId:branch,code,name:accountName,type:accountType
      })}>บันทึก</button>
     </footer>

   </FinanceDialog>

  </div>
 );
}
