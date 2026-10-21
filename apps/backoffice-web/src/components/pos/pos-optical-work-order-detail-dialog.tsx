"use client";
import {useEffect,useState} from "react";
import type {Language} from "@/lib/i18n";
import {opticalDetailText,opticalDetailStatus,opticalDetailDate} from "@/lib/optical-detail-i18n";
type WorkOrder={id:string;status:string;currency_code:string;total_amount:number;paid_total:number;accepted_at:string;due_at:string|null;note:string|null};
type Line={id:string;sku_snapshot:string|null;description_snapshot:string|null;quantity:number;unit_price:number;line_total:number};
type Payment={id:string;amount:number;method:string;received_at:string;reference_no:string|null};
type Info={order:WorkOrder;lines:Line[];payments:Payment[];financeReady:boolean;canManage:boolean};
type PrinterInfo={configured:boolean;paper_width_mm:58|80;printer_name:string|null};
const money=(x:number)=>Number(x||0).toLocaleString("en-US");
function workOrderActionError(lang:Language,error:string){
  const messages:Record<string,[string,string,string]>={
    "OPTICAL_MANAGER_PIN_INVALID":["PIN ผู้จัดการหรือเจ้าของร้านไม่ถูกต้อง กรุณาใช้ PIN ปัจจุบันของผู้มีสิทธิ์ในสาขานี้","Invalid manager/owner PIN for this branch.","PIN ຜູ້ຈັດການ ຫຼື ເຈົ້າຂອງຮ້ານບໍ່ຖືກຕ້ອງ"],
    "OPTICAL_MANAGER_PIN_REQUIRED":["กรุณากรอก PIN ผู้จัดการหรือเจ้าของร้าน","Manager/owner PIN required.","ກະລຸນາກອກ PIN ຜູ້ຈັດການ"],
    "OPTICAL_REFUND_REQUIRED_BEFORE_CANCELLATION":["ใบงานนี้รับเงินแล้ว ต้องคืนเงินจริงพร้อมบันทึกหลักฐานคืนเงินก่อน จึงจะยกเลิกได้","This order has received a payment. Refund with an auditable record before cancellation.","ໃບສັ່ງງານນີ້ຮັບເງິນແລ້ວ ຕ້ອງຄືນເງິນພ້ອມຫຼັກຖານກ່ອນຍົກເລີກ"],
    "OPTICAL_ORDER_CLOSED":["ใบสั่งงานปิดแล้ว จึงแก้ไขวันนัดรับไม่ได้","Work order is closed.","ໃບສັ່ງງານປິດແລ້ວ"],
    "OPTICAL_ORDER_ALREADY_TERMINAL":["ใบงานปิดหรือยกเลิกไปแล้ว","Work order already closed or cancelled.","ໃບສັ່ງງານປິດ ຫຼື ຍົກເລີກແລ້ວ"]
  };
  const code=Object.keys(messages).find(value=>error.includes(value));
  return code?messages[code][lang==="en"?1:lang==="lo"?2:0]:error;
}
function dueLabel(lang:Language,date:string|null){return date?opticalDetailDate(lang,date):opticalDetailText(lang,"ยังไม่กำหนด");}
function localToday(){
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
 const get=(type:string)=>parts.find(p=>p.type===type)?.value??"";
 return `${get("year")}-${get("month")}-${get("day")}`;
}
export function PosOpticalWorkOrderDetailDialog({id,onClose,onChanged,lang}:{id:string;onClose:()=>void;onChanged:()=>void;lang:Language}){
 const txt=(thai:string)=>opticalDetailText(lang,thai);
 const [info,setInfo]=useState<Info|null>(null),[error,setError]=useState("");
 const [notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 const [action,setAction]=useState<"date"|"cancel"|null>(null);
 const [due,setDue]=useState(""),[note,setNote]=useState(""),[managerPin,setManagerPin]=useState("");
 const [printer,setPrinter]=useState<PrinterInfo|null>(null),[printing,setPrinting]=useState(false);
 const previewUrl=`/api/pos/optical/work-orders/${encodeURIComponent(id)}/deposit-receipt?width=${printer?.paper_width_mm===58?58:80}`;
 useEffect(()=>{
  let live=true;setInfo(null);setError("");setNotice("");setAction(null);
  setPrinter(null);setManagerPin("");
  void (async()=>{
   try{
    const response=await fetch("/api/pos/optical/work-orders/manage?id="+encodeURIComponent(id),{cache:"no-store",credentials:"same-origin"});
    const body=await response.json() as {data?:Info;error?:{message?:string}};
    if(!response.ok||!body.data)throw new Error(body.error?.message??txt("ไม่สามารถโหลดรายละเอียดใบสั่งงาน"));
    if(!live)return;
    setInfo(body.data);setNote(body.data.order.note??"");
    setDue(body.data.order.due_at?.slice(0,10)??"");
   }catch(e){if(live)setError(e instanceof Error?e.message:txt("โหลดใบงานไม่สำเร็จ"));}
  })();
  void (async()=>{
   try{
    const response=await fetch(`/api/pos/optical/work-orders/${encodeURIComponent(id)}/print`,{cache:"no-store",credentials:"same-origin"});
    const body=await response.json() as {data?:PrinterInfo};
    if(live&&response.ok&&body.data)setPrinter(body.data);
   }catch{/* Preview link stays available if printers cannot be resolved. */}
  })();
  return()=>{live=false;};
 },[id]);
 const closeAction=()=>{if(!busy){setAction(null);setManagerPin("");setError("");}};
 const change=async()=>{
   if(!info||!action||busy)return;
   if(managerPin.trim().length<4)return setError(txt("กรุณากรอก PIN ผู้จัดการหรือเจ้าของร้านให้ถูกต้อง"));
   if(action==="date"&&(!due||!/^\d{4}-\d{2}-\d{2}$/.test(due)||due<localToday()))
     return setError(txt("กรุณาระบุวันนัดรับให้ถูกต้อง ตั้งแต่วันนี้เป็นต้นไป"));
   // Always require and verify an owner/manager PIN on the server.
   // The database independently prevents cancelling paid orders without refund reconciliation.
   if(action==="cancel"&&!window.confirm(txt("ยืนยันยกเลิกใบงาน โดยใช้ PIN ผู้จัดการหรือเจ้าของร้าน?")))return;
   setBusy(true);setError("");
   try{
    const response=await fetch("/api/pos/optical/work-orders/manage",{
      method:"PATCH",credentials:"same-origin",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        id,action:action==="date"?"update":"cancel",due_at:action==="date"?new Date(due+"T12:00:00+07:00").toISOString():null,
        note,manager_pin:managerPin,request_id:crypto.randomUUID()
      })
    });
    const body=await response.json() as {error?:{message?:string}};
    if(!response.ok)throw new Error(workOrderActionError(lang,body.error?.message??txt("ดำเนินการไม่สำเร็จ")));
    setManagerPin("");onChanged();onClose();
   }catch(e){setError(e instanceof Error?e.message:txt("บันทึกไม่สำเร็จ"));}
   finally{setBusy(false);}
 };
 const print=async()=>{
  if(printing||!printer?.configured){setError(txt("ยังไม่ได้กำหนดเครื่องพิมพ์ใบเสร็จในเมนูตั้งค่าเครื่องพิมพ์ของสาขา"));return;}
  setPrinting(true);setError("");setNotice("");
  try{
   const response=await fetch(`/api/pos/optical/work-orders/${encodeURIComponent(id)}/print`,{
     method:"POST",credentials:"same-origin",headers:{"X-Optical-Print-Request":crypto.randomUUID()}
   });
   const body=await response.json() as {data?:{queued:number};error?:{message?:string}};
   if(!response.ok)throw new Error(body.error?.message??txt("ส่งคิวพิมพ์ไม่สำเร็จ"));
   setNotice(lang==="lo"?`ສົ່ງໃບສັ່ງງານເຂົ້າຄິວເຄື່ອງພິມ ${printer.printer_name??""} ${body.data?.queued??1} ສະບັບ (ລໍຖ້າ Print Agent)`:lang==="en"?`Queued ${body.data?.queued??1} work-order copies for printer ${printer.printer_name??""} (awaiting Print Agent)`:`ส่งใบงานไปยังคิวเครื่องพิมพ์ ${printer.printer_name??""} แล้ว ${body.data?.queued??1} ฉบับ (รอ Print Agent ดำเนินการ)`);
  }catch(e){setError(e instanceof Error?e.message:txt("ไม่สามารถส่งงานพิมพ์"));}
  finally{setPrinting(false);}
 };
 const total=info?.order.total_amount??0,paid=info?.order.paid_total??0;
 const summary=(heading:string,value:string,accent=false)=><div className="rounded-xl bg-slate-50 px-4 py-3">
  <span className="mb-1 block text-xs font-medium text-slate-500">{heading}</span>
  <strong className={accent?"text-lg font-bold text-emerald-700":"text-sm font-bold text-slate-800"}>{value}</strong>
 </div>;
 return <div role="presentation" onClick={()=>{if(!busy&&!action)onClose();}}
  className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3 sm:p-6">
  <section role="dialog" aria-modal="true" aria-label={txt("รายละเอียดใบสั่งงาน")}
    onClick={event=>event.stopPropagation()}
    className="relative flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
   <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
     <div><span className="text-xs font-semibold tracking-wider text-emerald-700">CUSTOM · OPTICAL</span>
       <h2 className="mt-1 text-xl font-bold text-slate-900">{txt("รายละเอียดใบสั่งงาน")} <span className="text-emerald-700">#{id.slice(0,8).toUpperCase()}</span></h2>
       <p className="mt-1 text-xs text-slate-500">{txt("ตรวจสอบสินค้า การรับเงิน และกำหนดวันนัดรับ")}</p>
     </div>
     <button type="button" disabled={busy} onClick={onClose} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">{txt("ปิด")}</button>
   </header>
   <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
     {error?<p role="alert" className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>:null}
     {notice?<p role="status" className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>:null}
     {!info&&!error?<p className="py-8 text-center text-sm text-slate-500">{txt("กำลังโหลดใบสั่งงาน...")}</p>:null}
     {info?<div className="space-y-5">
       <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
         {summary(txt("สถานะ"),opticalDetailStatus(lang,info.order.status))}
         {summary(txt("ยอดรวม"),money(total)+" "+info.order.currency_code)}
         {summary(txt("รับเงินแล้ว"),money(paid)+" "+info.order.currency_code,true)}
         {summary(txt("ค้างชำระ"),money(Math.max(0,total-paid))+" "+info.order.currency_code,true)}
         {summary(txt("วันที่รับงาน"),opticalDetailDate(lang,info.order.accepted_at,true))}
         {summary(txt("วันนัดรับ"),dueLabel(lang,info.order.due_at))}
       </div>
       <div className="grid min-w-0 gap-4 md:grid-cols-2">
         <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200">
           <h3 className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800">{txt("รายการสินค้า")} <span className="font-normal text-slate-500">({info.lines.length})</span></h3>
           <div className="space-y-0 divide-y divide-slate-100 px-4">
             {info.lines.map(line=><div key={line.id} className="py-3 text-sm">
               <strong className="block text-slate-800">{line.description_snapshot||line.sku_snapshot||txt("สินค้า")}</strong>
               <span className="mt-1 block text-xs text-slate-500">SKU {line.sku_snapshot??"—"} · {line.quantity} {txt("ชิ้น")}</span>
               <span className="mt-1 block font-semibold text-slate-800">{money(line.line_total)} {info.order.currency_code}</span>
             </div>)}
             {!info.lines.length?<p className="py-4 text-sm text-slate-500">{txt("ไม่พบรายการสินค้า")}</p>:null}
           </div>
         </section>
         <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200">
           <h3 className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800">{txt("ประวัติการรับเงิน")} <span className="font-normal text-slate-500">({info.payments.length})</span></h3>
           <div className="divide-y divide-slate-100 px-4">
             {info.payments.map(payment=><div key={payment.id} className="py-3 text-sm">
               <strong className="block font-semibold text-slate-800">{money(payment.amount)} {info.order.currency_code}</strong>
               <span className="mt-1 block text-xs text-slate-500">{payment.method==="cash"?txt("เงินสด"):txt("เงินโอน")} · {opticalDetailDate(lang,payment.received_at,true)}</span>
             </div>)}
             {!info.financeReady?<p className="py-4 text-sm text-amber-700">{txt("ยังไม่ได้เปิดสิทธิ์ข้อมูลการเงิน")}</p>:!info.payments.length?
               <p className="py-4 text-sm text-slate-500">{txt("ยังไม่มีประวัติรับเงิน")}</p>:null}
           </div>
         </section>
       </div>
       <div className="flex flex-col gap-3 rounded-xl bg-emerald-50/60 p-4 sm:flex-row sm:items-center sm:justify-between">
         <div>
           <h3 className="text-sm font-bold text-emerald-900">{txt("พิมพ์ใบสั่งงานพร้อมบาร์โค้ด")}</h3>
           <p className="mt-1 text-xs text-slate-600">{printer?.configured?
             `${txt("ใช้เครื่องพิมพ์")} ${printer.printer_name??txt("ใบเสร็จ")} · ${printer.paper_width_mm} mm ${txt("ตามการตั้งค่าสาขา")}`:
             txt("ใช้การตั้งค่าเครื่องพิมพ์ของสาขา (58/80 mm)")}</p>
         </div>
         <div className="flex flex-wrap gap-2">
           {paid>0?<a href={previewUrl} target="_blank" rel="noopener noreferrer"
             className="rounded-lg border border-emerald-300 bg-white px-4 py-2 text-center text-sm font-semibold text-emerald-800">{txt("ดูตัวอย่างใบงาน")}</a>:null}
           <button type="button" disabled={paid<=0||printing||!printer?.configured}
             onClick={()=>void print()} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
             {printing?txt("กำลังส่งคิวพิมพ์..."):txt("พิมพ์ตามการตั้งค่าเครื่องพิมพ์")}</button>
         </div>
       </div>
       {paid>0&&!printer?.configured?<p className="text-xs text-amber-700">{txt("ยังไม่พบเครื่องพิมพ์ใบเสร็จสำหรับสาขา กรุณาตั้งค่าที่เมนูตั้งค่าเครื่องพิมพ์ ก่อนกดพิมพ์โดยตรง")}</p>:null}
       <p className="text-xs text-slate-500">{txt("การเปลี่ยนวันนัดรับไม่แก้รายการสินค้า ยอดขาย หรือประวัติเงินมัดจำเดิม การยกเลิกงานที่รับเงินแล้วต้องผ่านกระบวนการคืนเงิน")}</p>
     </div>:null}
   </div>
   {info?<footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-4 sm:px-6">
     {info.canManage&&!["collected","cancelled"].includes(info.order.status)?<>
       <button type="button" className="mr-auto rounded-lg border border-rose-200 bg-white px-4 py-2 text-sm font-medium text-rose-700"
          onClick={()=>{setError("");setAction("cancel");}}>{txt("ยกเลิกใบงาน")}</button>
       <button type="button" className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-800"
         onClick={()=>{setError("");setAction("date");}}>{txt("ใส่วันนัดรับ")}</button>
     </>:null}
   </footer>:null}
   {action?<div className="absolute inset-0 z-[120] flex items-center justify-center rounded-2xl bg-slate-950/50 p-4" role="presentation">
     <div role="dialog" aria-modal="true" aria-label={action==="date"?txt("ใส่วันนัดรับ"):txt("ยกเลิกใบงาน")}
       className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 shadow-xl">
       <header><h3 className="text-lg font-bold">{action==="date"?txt("ใส่วันนัดรับ"):txt("ยืนยันยกเลิกใบงาน")}</h3>
         <p className="mt-1 text-xs text-slate-500">{txt("ใช้ PIN ผู้จัดการหรือเจ้าของร้าน เพื่อยืนยันการดำเนินการ")}</p></header>
       {action==="date"?<>
         <label className="grid gap-1 text-sm font-semibold">{txt("วันนัดรับแว่น *")}
           <input type="date" required min={localToday()} value={due} onChange={e=>setDue(e.target.value)}
             className="min-h-11 rounded-lg border border-slate-300 px-3 py-2"/></label>
         <label className="grid gap-1 text-sm font-semibold">{txt("หมายเหตุ")}
           <textarea maxLength={1000} rows={3} value={note} onChange={e=>setNote(e.target.value)}
             className="rounded-lg border border-slate-300 p-3"/></label>
       </>:<div className="space-y-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
        <p>{txt("การยกเลิกใบงานต้องยืนยันด้วย PIN ผู้จัดการหรือเจ้าของร้าน")}</p>
        {paid>0?<p className="font-semibold">{txt("ใบงานนี้มีเงินรับแล้ว")} {money(paid)} {info?.order.currency_code} · {txt("ต้องคืนเงินจริงและบันทึกหลักฐานคืนเงินก่อน จึงจะยกเลิกได้")}</p>:
          <p>{txt("การยกเลิกจะคืนสต๊อกที่จองไว้ พร้อมบันทึกประวัติไว้ตรวจสอบ")}</p>}
       </div>}
       <label className="grid gap-1 text-sm font-semibold">{txt("PIN ผู้จัดการหรือเจ้าของร้าน *")}
         <input type="password" inputMode="numeric" autoComplete="off" maxLength={32} value={managerPin}
           onChange={e=>setManagerPin(e.target.value)} className="min-h-11 rounded-lg border border-slate-300 px-3 py-2"/></label>
       {error?<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>:null}
       <div className="flex justify-end gap-2">
         <button type="button" disabled={busy} onClick={closeAction} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">{txt("ยกเลิก")}</button>
         <button type="button" disabled={busy} onClick={()=>void change()}
           className={action==="cancel"?"rounded-lg bg-rose-700 px-4 py-2 text-sm font-bold text-white":"rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white"}>
           {busy?txt("กำลังบันทึก..."):action==="date"?txt("บันทึกวันนัดรับ"):txt("ยืนยันยกเลิกใบงาน")}</button>
       </div>
     </div>
   </div>:null}
  </section>
 </div>;
}
