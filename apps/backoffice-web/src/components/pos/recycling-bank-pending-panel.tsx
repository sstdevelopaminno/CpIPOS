"use client";
import {useCallback,useEffect,useRef,useState} from "react";
type Tx={id:string;receipt_no?:string;total_minor:number};
type Intent={id:string;request_id:string;direction:"buy"|"sell";counterparty_name:string;expected_minor:number;evidence_id:string|null;transaction:{id:string;receipt_no:string;status:string}|null};
const endpoint="/api/pos/recycling/bank-transfers";
export function RecyclingBankPendingPanel({canPost,onClose,onCommitted}:{canPost:boolean;onClose:()=>void;onCommitted:(tx:Tx,requestId:string)=>Promise<void>}){
 const [rows,setRows]=useState<Intent[]>([]);
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 const locked=useRef(false);
 const refresh=useCallback(async()=>{
   try{const response=await fetch(endpoint+"?mine=1",{credentials:"same-origin",cache:"no-store"});const body=await response.json();
     if(!response.ok||!Array.isArray(body?.data?.intents))throw Error(body?.error?.message??"ไม่สามารถอ่านคำขอได้");
     setRows(body.data.intents);setError("");
   }catch(e){setError(e instanceof Error?e.message:"ไม่สามารถอ่านคำขอได้");}
 },[]);
 useEffect(()=>{void refresh();},[refresh]);
 async function finalize(row:Intent){
   if(locked.current||!canPost||!row.evidence_id||row.transaction)return;
   locked.current=true;setBusy(true);setError("");
   try{const response=await fetch(endpoint,{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({intent_id:row.id})});const body=await response.json();
     if(!response.ok||!body?.data?.transaction?.id)throw Error(body?.error?.message??"ยังไม่ยืนยันผลบิล ห้ามรับหรือจ่ายเงินซ้ำ");
     await onCommitted(body.data.transaction,row.request_id);
   }catch(e){setError(e instanceof Error?e.message:"ยังไม่ยืนยันผลบิล");}
   finally{locked.current=false;setBusy(false);}
 }
 return <div className="fixed inset-0 z-[1250] flex items-center justify-center bg-slate-950/70 p-3" role="presentation">
 <section role="dialog" aria-modal="true" aria-label="คำขอเงินโอนของฉัน" className="w-full max-w-xl max-h-[85vh] overflow-auto rounded-xl bg-white p-5 shadow-xl">
 <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-extrabold">คำขอเงินโอนของฉัน</h2><button type="button" disabled={busy} onClick={onClose} className="rounded border px-3 py-2">ปิด</button></div>
 <p className="mt-2 text-sm text-slate-600">ตรวจหลักฐานแล้วจึงยืนยันบิล ห้ามรับหรือจ่ายเงินซ้ำเมื่อการเชื่อมต่อขัดข้อง</p>
 <button type="button" disabled={busy} onClick={()=>void refresh()} className="my-3 rounded border px-3 py-2 text-sm font-bold">รีเฟรชสถานะ</button>
 {error&&<p role="alert" className="mb-3 rounded bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
 {!rows.length&&!error&&<p className="text-sm text-slate-500">ไม่พบคำขอในสาขานี้</p>}
 {rows.map(row=><div key={row.id} className="mb-2 rounded border p-3 text-sm">
   <strong>{row.direction==="buy"?"รับซื้อ":"ขายออก"} · {row.counterparty_name} · {(Number(row.expected_minor)/100).toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2})} บาท</strong>
   <p className="my-1 text-xs text-slate-500">{row.request_id}</p>
   {row.transaction?<a className="font-bold text-blue-800" href={`/preview/pos/recycling/receipts/${row.transaction.id}`}>บันทึกแล้ว · {row.transaction.receipt_no} ({row.transaction.status}) · ดูใบเสร็จ</a>:row.evidence_id?<button type="button" disabled={busy||!canPost} onClick={()=>void finalize(row)} className="rounded bg-blue-700 px-3 py-2 font-bold text-white disabled:opacity-50">ยืนยันบิลและพิมพ์</button>:<span className="font-bold text-amber-800">รอผู้ตรวจสอบหลักฐาน</span>}
 </div>)}
 </section></div>;
}
