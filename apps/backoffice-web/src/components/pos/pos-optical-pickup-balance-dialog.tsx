"use client";
import {useRef,useState} from "react";
import {requestOpticalWorkOrderPrint} from "@/lib/printing/optical-work-order-print-client";

export type OpticalRecalledOrder={
  bill:{id:string;status:string;total_amount:number;paid_total:number;currency_code:string;due_at:string|null};
  lines:Array<{sku_snapshot:string;description_snapshot:string;quantity:number;line_total:number}>;
  remaining_amount:number;
};
const money=(x:number)=>Number(x||0).toLocaleString("en-US")+" LAK";
export function PosOpticalPickupBalanceDialog({data,onClose,onSettled}:{
  data:OpticalRecalledOrder;onClose:()=>void;onSettled:(id:string)=>void;
}){
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const [remaining,setRemaining]=useState(data.remaining_amount);
  const [settled,setSettled]=useState(false);
  const [printing,setPrinting]=useState(false),[printNotice,setPrintNotice]=useState("");
  const requestId=useRef(crypto.randomUUID());
  const orderId=data.bill.id;
  async function settle(){
    if(busy||settled)return;
    if(!window.confirm("ยืนยันว่ารับเงินสดยอดค้างชำระ "+money(remaining)+" จากลูกค้าแล้ว?"))return;
    setBusy(true);setError("");
    try{
      const res=await fetch(`/api/pos/optical/work-orders/${encodeURIComponent(orderId)}/payments`,{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({request_id:requestId.current,amount_lak:remaining,method:"cash"})
      });
      const body=await res.json() as {data?:{remaining_amount:number};error?:{message?:string}};
      if(!res.ok||!body.data)throw new Error(body.error?.message||"ไม่สามารถบันทึกรับยอดค้างชำระ");
      setRemaining(Number(body.data.remaining_amount));
      setSettled(true);onSettled(orderId);
    }catch(e){setError(e instanceof Error?e.message:"บันทึกยอดคงเหลือไม่สำเร็จ");}
    finally{setBusy(false);}
  }
  async function print(){
    if(printing)return;
    setPrinting(true);setError("");setPrintNotice("");
    try{
      const result=await requestOpticalWorkOrderPrint(orderId);
      setPrintNotice(`ส่งใบเสร็จ ${result.queued} ฉบับเข้าคิวเครื่องพิมพ์ที่ตั้งค่าไว้แล้ว`);
    }catch(e){setError(e instanceof Error?e.message:"ไม่สามารถส่งพิมพ์ได้ กรุณาตรวจสอบการตั้งค่าเครื่องพิมพ์");}
    finally{setPrinting(false);}
  }
  return <div className="fixed inset-0 z-[190] flex items-center justify-center bg-slate-950/60 p-3" role="presentation">
    <section role="dialog" aria-modal="true" aria-label="ใบงานนัดรับและยอดค้างชำระ"
      className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
      <header className="flex justify-between gap-3">
        <h2 className="text-xl font-bold text-slate-900">เรียกใบสั่งงานด้วยบาร์โค้ด</h2>
        <button type="button" className="rounded-lg border px-3 py-2" onClick={onClose} disabled={busy}>ปิด</button>
      </header>
      <p className="mt-2 break-all text-xs text-slate-500">ใบงาน {orderId} · นัดรับ: {data.bill.due_at?.slice(0,10)||"ยังไม่กำหนด"}</p>
      <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
        <span>ยอดเต็ม</span><strong className="text-right">{money(data.bill.total_amount)}</strong>
        <span>รับมัดจำแล้ว</span><strong className="text-right">{money(data.bill.paid_total)}</strong>
        <span className="font-bold">ยอดค้างชำระ</span><strong className="text-right text-xl text-emerald-800">{money(remaining)}</strong>
      </div>
      <h3 className="mb-2 mt-4 font-bold">รายการสินค้าในใบสั่งงาน</h3>
      <div className="max-h-44 overflow-y-auto rounded-xl border">
        {data.lines.map((line,i)=><div key={i} className="flex justify-between gap-3 border-b p-3 text-sm">
          <span>{line.description_snapshot} <small className="block text-slate-500">SKU {line.sku_snapshot} · {line.quantity} ชิ้น</small></span>
          <strong className="shrink-0">{money(line.line_total)}</strong>
        </div>)}
      </div>
      {error?<p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>:null}
      {settled?<p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 font-bold text-emerald-800">
        บันทึกรับยอดค้างชำระในบัญชีแล้ว · คงเหลือ {money(remaining)}
      </p>:<p className="mt-3 text-xs text-slate-600">
        สแกนบาร์โค้ดเป็นเพียงการค้นใบงาน การรับเงินต้องยืนยันแยกต่างหาก
        เงินโอนต้องให้ Owner/Manager ตรวจสอบบัญชีจริงก่อนลงบัญชี ไม่สามารถยืนยันอัตโนมัติจากการสแกน
      </p>}
      {printNotice?<p role="status" className="mt-3 text-sm text-emerald-700">{printNotice}</p>:null}
      <footer className="mt-4 flex flex-wrap items-end justify-end gap-2">
        {settled?<a href={`/api/pos/optical/work-orders/${encodeURIComponent(orderId)}/deposit-receipt`}
          target="_blank" rel="noopener noreferrer" className="rounded-lg border border-emerald-300 px-4 py-2 text-sm text-emerald-800">
          ดูตัวอย่างใบเสร็จ</a>:null}
        <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border px-4 py-2">ปิด</button>
        {settled?<button type="button" disabled={printing} onClick={()=>void print()}
          className="rounded-lg bg-emerald-700 px-4 py-2 font-bold text-white disabled:opacity-60">
          {printing?"กำลังส่งพิมพ์...":"พิมพ์ผ่านเครื่องพิมพ์ที่ตั้งค่าไว้"}</button>:
        <button type="button" disabled={busy||remaining<=0} onClick={()=>void settle()}
          className="rounded-lg bg-emerald-700 px-4 py-2 font-bold text-white">
          {busy?"กำลังบันทึก...":"ยืนยันรับเงินสดคงเหลือ "+money(remaining)}
        </button>}
      </footer>
    </section>
  </div>;
}
