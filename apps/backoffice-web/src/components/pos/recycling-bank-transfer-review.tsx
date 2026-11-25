"use client";
import {useCallback,useEffect,useState} from "react";
import {RecyclingBankAccountSetup} from "@/components/pos/recycling-bank-account-setup";
type Intent={id:string;request_id:string;operator_user_id:string;direction:"buy"|"sell";counterparty_name:string;expected_minor:number; evidence_id:string|null;created_at:string};
type Account={id:string;bank_code:string;account_last4:string;account_label:string};
type Status={intents:Intent[];accounts:Account[];can_review:boolean;actor_id:string};
const endpoint="/api/pos/recycling/bank-transfers";
export function RecyclingBankTransferReview({canManageAccounts=false}:{canManageAccounts?:boolean}){
 const [status,setStatus]=useState<Status|null>(null);
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 const [selected,setSelected]=useState<Intent|null>(null);
 const refresh=useCallback(async()=>{
   try{const res=await fetch(endpoint,{credentials:"same-origin",cache:"no-store"});const body=await res.json();
     if(!res.ok)throw Error(body.error?.message??"ไม่สามารถตรวจสอบคำขอเงินโอน");
     setStatus(body.data);setError("");
   }catch(e){setStatus(null);setError(e instanceof Error?e.message:"ไม่สามารถตรวจสอบคำขอเงินโอน");}
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 return <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
   <div><h2 className="text-lg font-extrabold">ตรวจสอบรายการเงินโอน Recycling</h2><p className="text-sm text-slate-600">ตรวจสอบจากรายการเดินบัญชีธนาคารจริง ไม่ใช่การยืนยันด้วยภาพสลิปหรือ AI เพียงอย่างเดียว</p></div>
   <button type="button" onClick={()=>void refresh()} disabled={busy} className="rounded border px-3 py-2 text-sm font-bold">ตรวจสอบคำขอล่าสุด</button>
   {error&&<p role="alert" className="rounded bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
   {canManageAccounts&&<RecyclingBankAccountSetup onSaved={refresh}/>}
   {status&&!status.accounts.length&&<p className="text-sm text-amber-900">ยังไม่มีบัญชีธนาคารของสาขาที่ผ่านการยืนยันหลักฐาน</p>}
   {status?.intents.map(intent=><div key={intent.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3 text-sm">
      <div><strong>{intent.direction==="buy"?"จ่ายรับซื้อ":"รับเงินขายออก"} · {intent.counterparty_name}</strong><p className="text-xs text-slate-500">{intent.request_id}</p></div>
      <strong>{(Number(intent.expected_minor)/100).toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</strong>
      {intent.evidence_id?<span className="font-bold text-emerald-800">ตรวจหลักฐานแล้ว · รอยืนยันบิลหรือบันทึกแล้ว</span>:<button disabled={busy||!status.can_review||intent.operator_user_id===status.actor_id||!status.accounts.length} onClick={()=>{setError("");setSelected(intent);}} type="button" className="rounded bg-blue-700 px-3 py-2 font-bold text-white disabled:opacity-50">ตรวจสอบ</button>}
   </div>)}
   {selected&&status?.can_review&&<form key={selected.id} className="grid gap-3 rounded border p-3 sm:grid-cols-2" onSubmit={async e=>{
     e.preventDefault();if(busy)return;const f=new FormData(e.currentTarget);const raw=String(f.get("amount")??"");
     if(!/^\d{1,12}(\.\d{1,2})?$/.test(raw)){setError("ยอดเงินต้องระบุเป็นบาทและสตางค์");return;}
     const parts=raw.split(".");const amount_minor=Number(parts[0])*100+Number((parts[1]??"").padEnd(2,"0"));
     const date=String(f.get("transfer_at")??"");
     if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(date)){setError("ระบุเวลาโอนตามเวลาไทย");return;}
     setBusy(true);setError("");
     try{const response=await fetch(endpoint,{method:"PATCH",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({intent_id:selected.id,bank_account_id:f.get("account"),bank_reference:String(f.get("reference")??"").trim().toUpperCase(),amount_minor,transfer_at:date+":00+07:00",statement_evidence_reference:f.get("evidence"),confirmed:f.get("confirmed")==="on"})});
       const body=await response.json();if(!response.ok)throw Error(body.error?.message??"ตรวจสอบไม่สำเร็จ");setSelected(null);await refresh();
     }catch(e){setError(e instanceof Error?e.message:"ไม่สามารถยืนยันผล");}finally{setBusy(false);}
   }}>
     <label className="grid gap-1 text-sm">บัญชีของสาขา<select name="account" required className="rounded border p-2"><option value="">เลือกบัญชี</option>{status.accounts.map(a=><option key={a.id} value={a.id}>{a.account_label} · {a.bank_code} •••• {a.account_last4}</option>)}</select></label>
     <label className="grid gap-1 text-sm">ยอดตามรายการธนาคาร (บาท)<input required name="amount" inputMode="decimal" className="rounded border p-2"/></label>
     <label className="grid gap-1 text-sm">เลขอ้างอิงธนาคาร<input required name="reference" minLength={6} maxLength={100} className="rounded border p-2"/></label>
     <label className="grid gap-1 text-sm">วันเวลาโอน (เวลาไทย)<input required name="transfer_at" type="datetime-local" className="rounded border p-2"/></label>
     <label className="grid gap-1 text-sm sm:col-span-2">เลขอ้างอิงหลักฐานรายการเดินบัญชี<input required name="evidence" minLength={5} maxLength={500} className="rounded border p-2"/></label>
     <label className="flex items-start gap-2 text-sm sm:col-span-2"><input required type="checkbox" name="confirmed"/>ยืนยันตรวจสอบยอดจริงและทิศทางเงินเข้า/ออกในบัญชีสาขาแล้ว</label>
     <button type="submit" disabled={busy} className="rounded bg-blue-700 p-2 font-bold text-white disabled:opacity-50">ยืนยันหลักฐาน</button><button type="button" disabled={busy} onClick={()=>setSelected(null)} className="rounded border p-2">ย้อนกลับ</button>
   </form>}
 </section>;
}
