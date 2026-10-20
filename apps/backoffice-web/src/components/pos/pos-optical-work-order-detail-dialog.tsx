"use client";
import {useEffect,useState} from "react";
type WorkOrder={id:string;status:string;currency_code:string;total_amount:number;paid_total:number;accepted_at:string;due_at:string|null;note:string|null};
type Line={id:string;sku_snapshot:string|null;description_snapshot:string|null;quantity:number;unit_price:number;line_total:number};
type Payment={id:string;amount:number;method:string;received_at:string;reference_no:string|null};
type Info={order:WorkOrder;lines:Line[];payments:Payment[];financeReady:boolean;canManage:boolean};
const money=(x:number)=>Number(x||0).toLocaleString("en-US");
const label:Record<string,string>={received:"รับงานแล้ว",lens_ordered:"สั่งเลนส์",edging:"ประกอบแว่น",
 ready_for_pickup:"พร้อมรับ",collected:"ส่งมอบแล้ว",cancelled:"ยกเลิก"};
export function PosOpticalWorkOrderDetailDialog({id,onClose,onChanged}:{id:string;onClose:()=>void;onChanged:()=>void}){
 const [info,setInfo]=useState<Info|null>(null),[error,setError]=useState("");
 const [busy,setBusy]=useState(false),[editing,setEditing]=useState(false);
 const [note,setNote]=useState(""),[due,setDue]=useState("");
 useEffect(()=>{
  let active=true;setInfo(null);setError("");setEditing(false);
  void (async()=>{
   try{
    const r=await fetch("/api/pos/optical/work-orders/manage?id="+encodeURIComponent(id),{cache:"no-store",credentials:"same-origin"});
    const b=await r.json() as {data?:Info;error?:{message?:string}};
    if(!r.ok)throw new Error(b.error?.message??"ไม่สามารถโหลดรายละเอียดใบสั่งงาน");
    if(!active||!b.data)return;
    setInfo(b.data);setNote(b.data.order.note??"");
    setDue(b.data.order.due_at?b.data.order.due_at.slice(0,10):"");
   }catch(e){if(active)setError(e instanceof Error?e.message:"ไม่สามารถเปิดรายละเอียดใบสั่งงาน");}
  })();
  return()=>{active=false;};
 },[id]);
 const act=async(action:"update"|"cancel")=>{
  if(!info||busy)return;
  if(action==="cancel"&&!window.confirm("ยืนยันยกเลิกใบงาน? ระบบจะตรวจยอดรับเงินและปล่อยสต๊อกที่จองไว้ตามเงื่อนไข"))return;
  setBusy(true);setError("");
  try{
   const dueAt=due?new Date(due+"T12:00:00+07:00").toISOString():null;
   const response=await fetch("/api/pos/optical/work-orders/manage",{
     method:"PATCH",credentials:"same-origin",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({id,action,note,due_at:dueAt,request_id:crypto.randomUUID()})
   });
   const b=await response.json() as {error?:{message?:string}};
   if(!response.ok)throw new Error(b.error?.message??"ดำเนินการไม่สำเร็จ");
   onChanged();onClose();
  }catch(e){setError(e instanceof Error?e.message:"ดำเนินการไม่สำเร็จ");}
  finally{setBusy(false);}
 };
 const item=(name:string,value:string)=><p className="rounded-xl bg-slate-50 p-3 text-sm">
  <span className="block text-xs text-slate-500">{name}</span><strong>{value}</strong></p>;
 return <div role="presentation" onClick={()=>{if(!busy)onClose();}}
  className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-3">
  <section role="dialog" aria-modal="true" aria-label="รายละเอียดใบสั่งงาน"
    className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={e=>e.stopPropagation()}>
   <div className="flex justify-between gap-3"><h3 className="text-xl font-bold">รายละเอียดใบสั่งงาน · {id.slice(0,8).toUpperCase()}</h3>
    <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border px-3 py-2">ปิด</button></div>
   {error?<p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-rose-700">{error}</p>:null}
   {!info&&!error?<p className="p-4">กำลังโหลด...</p>:null}
   {info?<div className="mt-4 grid gap-4">
    <div className="grid gap-2 sm:grid-cols-3">
     {item("สถานะ",label[info.order.status]??info.order.status)}
     {item("ยอดรวม",money(info.order.total_amount)+" "+info.order.currency_code)}
     {item("รับเงินแล้ว",money(info.order.paid_total)+" "+info.order.currency_code)}
     {item("ค้างชำระ",money(Math.max(0,info.order.total_amount-info.order.paid_total))+" "+info.order.currency_code)}
     {item("วันที่รับงาน",new Date(info.order.accepted_at).toLocaleString("th-TH"))}
     {item("นัดรับ",info.order.due_at?.slice(0,10)??"—")}
    </div>
    <div className="rounded-xl border p-3"><h4 className="mb-2 font-bold">รายการสินค้า</h4>
     {info.lines.map(l=><p key={l.id} className="border-t p-2 text-sm">
       {l.description_snapshot||l.sku_snapshot||"สินค้า"} · {l.quantity} ชิ้น · {money(l.line_total)} {info.order.currency_code}
     </p>)}
     {!info.lines.length?<p className="text-sm text-slate-500">ไม่พบรายการในใบสั่งงาน</p>:null}
    </div>
    <div className="rounded-xl border p-3"><h4 className="font-bold">ประวัติการรับเงิน</h4>
     {info.payments.map(p=><p key={p.id} className="border-t p-2 text-sm">
       {new Date(p.received_at).toLocaleString("th-TH")} · {p.method} · {money(p.amount)} {info.order.currency_code}
     </p>)}
     {!info.financeReady?<p className="text-sm text-amber-800">ประวัติการเงินต้องผ่าน IT approval และ Optical finance rollout ก่อนเปิดอ่าน</p>:
     !info.payments.length?<p className="text-sm text-slate-500">ยังไม่มีรายการรับเงิน</p>:null}
    </div>
    {editing?<div className="grid gap-3 rounded-xl border p-3">
      <label className="grid gap-1 text-sm font-semibold">นัดรับ<input type="date" value={due}
        className="rounded-lg border px-3 py-2" onChange={e=>setDue(e.target.value)}/></label>
      <label className="grid gap-1 text-sm font-semibold">หมายเหตุ
        <textarea value={note} maxLength={1000} className="rounded-lg border p-3" onChange={e=>setNote(e.target.value)}/>
      </label>
      <p className="text-xs text-slate-500">แก้ไขได้เฉพาะใบงานสถานะรับงานที่ยังไม่มีการชำระ ไม่ปรับยอดเงินหรือรายการสินค้า</p>
    </div>:null}
    <div className="flex flex-wrap gap-2">
      {info.canManage&&info.order.status==="received"&&info.order.paid_total===0?
       <button type="button" className="rounded-lg border border-blue-300 px-4 py-2 text-blue-700" onClick={()=>editing?void act("update"):setEditing(true)}>
         {editing?"บันทึกการแก้ไข":"แก้ไขใบสั่งงาน"}</button>:null}
      {info.canManage&&!["collected","cancelled"].includes(info.order.status)&&info.order.paid_total===0?
       <button type="button" className="rounded-lg border border-rose-300 px-4 py-2 text-rose-700"
         onClick={()=>void act("cancel")}>ลบ (ยกเลิกใบงาน)</button>:null}
      {!info.canManage?<p className="text-xs text-amber-800">แก้ไข/ยกเลิกได้โดย Owner/Manager หลัง IT อนุมัติ Optical finance และเปิด rollout แล้วเท่านั้น</p>:null}
    </div>
   </div>:null}
  </section>
 </div>;
}
