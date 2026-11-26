"use client";
import {useRef,useState} from "react";
import {readLine} from "@/lib/recycling-transaction-input";
type Line={id:string;product_id:string;name_snapshot:string;original_unit:string;original_quantity:number;price_per_base:number};
type Bill={receipt_no:string;effective_document_at:string;total_minor:number;settlement:string};
export function RecyclingAmountCorrectionEditor({id,source,onSaved}:{id:string;source:"pos"|"finance";onSaved:()=>void}){
 const [open,setOpen]=useState(false),[bill,setBill]=useState<Bill|null>(null),[lines,setLines]=useState<Line[]>([]),[qty,setQty]=useState<string[]>([]);
 const [reason,setReason]=useState(""),[stock,setStock]=useState(false),[cash,setCash]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[saved,setSaved]=useState("");
 const inFlight=useRef(false),retry=useRef<{id:string;payload:string}|null>(null);
 const endpoint=(source==="pos"?"/api/pos/recycling/transactions/":"/api/finance/recycling/transactions/")+encodeURIComponent(id)+"/amount-correction";
 async function show(){
  if(inFlight.current)return;
  inFlight.current=true;setOpen(true);setBusy(true);setError("");setBill(null);setLines([]);setReason("");setStock(false);setCash(false);setSaved("");
  try{const res=await fetch(endpoint,{cache:"no-store",credentials:"same-origin"});const body=await res.json();if(!res.ok||!body?.data?.transaction||!Array.isArray(body.data.lines))throw Error(body?.error?.message??"อ่านบิลไม่สำเร็จ");setBill(body.data.transaction);setLines(body.data.lines);setQty(body.data.lines.map((l:Line)=>String(l.original_quantity)));}
  catch(e){setError(e instanceof Error?e.message:"อ่านบิลไม่สำเร็จ");}finally{inFlight.current=false;setBusy(false);}
 }
 async function save(){
  if(!bill||inFlight.current||saved)return;
  const items=lines.map((l,i)=>readLine({product_id:l.product_id,unit:l.original_unit,quantity:qty[i],expected_price:l.price_per_base}));
  if(items.some(x=>x===null)||reason.trim().length<10||!stock||(bill.settlement==="cash"&&!cash)){setError("กรุณาตรวจสอบจำนวน เหตุผล และยืนยันการกระทบยอด");return;}
  const payload=JSON.stringify({expected_at:bill.effective_document_at,expected_total:Number(bill.total_minor),lines:items,reason:reason.trim(),stock_verified:stock,cash_verified:cash});
  if(!retry.current||retry.current.payload!==payload)retry.current={id:crypto.randomUUID(),payload};
  inFlight.current=true;setBusy(true);setError("");
  try{const res=await fetch(endpoint,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({...JSON.parse(payload),request_id:retry.current.id})});const body=await res.json().catch(()=>null);if(!res.ok||body?.data?.applied!==true)throw Error(body?.error?.message??"ไม่สามารถยืนยันการบันทึกได้");
   retry.current=null;setSaved("บันทึกสำเร็จ บิลทดแทน "+String(body.data.replacement_receipt_no)+" ยอด "+(Number(body.data.new_total_minor)/100).toFixed(2)+" บาท");
  }catch(e){setError(e instanceof Error?e.message:"ไม่สามารถยืนยันการบันทึกได้");}finally{inFlight.current=false;setBusy(false);}
 }
 function close(){if(busy)return;setOpen(false);if(saved)onSaved();}
 return <><button type="button" onClick={()=>void show()} className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">แก้ไขจำนวน / น้ำหนัก</button>
 {open&&<div className="fixed inset-0 z-[1900] flex items-center justify-center bg-slate-950/60 p-4" role="presentation"><form role="dialog" aria-modal="true" aria-label="แก้ไขจำนวนและน้ำหนัก" onSubmit={e=>{e.preventDefault();void save();}} onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();close();}}} className="max-h-[90dvh] w-full max-w-xl space-y-3 overflow-y-auto rounded-xl bg-white p-5 text-left shadow-xl">
 <h3 className="text-lg font-extrabold">แก้ไขจำนวนและน้ำหนัก</h3><p className="text-xs text-slate-600">ระบบจะยกเลิกบิลเดิมและออกบิลทดแทนในรายการเดียว ราคาต้องตรงกับราคาปัจจุบันในระบบ ไม่รองรับบิลที่ต้องกลับ GL หรือปรับต้นทุนย้อนหลังในหน้าต่างนี้</p>
 {bill&&<><p className="font-bold">{bill.receipt_no} · ยอดเดิม {(Number(bill.total_minor)/100).toFixed(2)} บาท</p>
 {lines.map((l,i)=><label key={l.id} className="block rounded border p-2 text-sm">{l.name_snapshot} · {l.original_unit} · ราคาเดิม {Number(l.price_per_base).toFixed(2)} บาท/หน่วยฐาน<input type="text" inputMode="decimal" required disabled={busy||!!saved} value={qty[i]??""} onChange={e=>setQty(v=>v.map((x,j)=>i===j?e.target.value:x))} className="mt-1 w-full rounded border p-2"/></label>)}
 <label className="block text-sm">เหตุผล<textarea required minLength={10} maxLength={500} disabled={busy||!!saved} value={reason} onChange={e=>setReason(e.target.value)} className="mt-1 w-full rounded border p-2"/></label>
 <label className="flex gap-2 text-sm"><input type="checkbox" required checked={stock} disabled={busy||!!saved} onChange={e=>setStock(e.target.checked)}/>ตรวจสอบการเคลื่อนไหววัสดุจริงแล้ว</label>
 {bill.settlement==="cash"&&<label className="flex gap-2 text-sm"><input type="checkbox" required checked={cash} disabled={busy||!!saved} onChange={e=>setCash(e.target.checked)}/>ยืนยันการชำระ/คืนส่วนต่างเงินจริงแล้ว</label>}</>}
 {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{saved&&<p role="status" className="text-sm font-bold text-emerald-700">{saved}</p>}
 <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={close} className="rounded border px-3 py-2">ปิด</button>{bill&&!saved&&<button type="submit" disabled={busy} className="rounded bg-blue-700 px-3 py-2 font-bold text-white">บันทึกและออกบิลทดแทน</button>}</div></form></div>}</>;
}
