"use client";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {recyclingShiftIsToday} from "@/lib/recycling-business-day";

type ShiftInfo={id:string;status:string;opened_at:string;opening_cash:number|null};
type Result<T>={data?:T;error?:{code?:string;message?:string}};
export function RecyclingShiftPrintButton({shiftId,automatic=false}:{
 shiftId:string;automatic?:boolean
}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function print(){
  if(busy)return;
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/pos/shifts/"+encodeURIComponent(shiftId)+"/print",{
    method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({print_mode:"manual",request_id:crypto.randomUUID()})
   });
   const body=await response.json().catch(()=>null) as Result<{jobs?:unknown[]}>|null;
   setMessage(response.ok?"ส่งใบสรุปปิดกะเข้าคิวพิมพ์แล้ว":
     body?.error?.message??"ไม่สามารถพิมพ์รายงานได้");
  }catch{setMessage("เครื่องพิมพ์ไม่พร้อมใช้งาน");}
  finally{setBusy(false);}
 }
 return <div className="flex flex-col items-start gap-1">
  <button type="button" onClick={()=>void print()} disabled={busy}
   className="whitespace-nowrap rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-bold text-blue-700 disabled:opacity-50">
   {busy?"กำลังส่ง...":automatic?"พิมพ์ใบสรุปอัตโนมัติ":"พิมพ์ใบสรุป"}
  </button>
  {message&&<small role="status" className="max-w-44 text-xs text-slate-600">{message}</small>}
 </div>;
}
export function RecyclingShiftControl({branchName}: {branchName:string}){
 const router=useRouter();
 const [shift,setShift]=useState<ShiftInfo|null>(null);
 const [loading,setLoading]=useState(true);
 const [closing,setClosing]=useState(false);
 const [closingCash,setClosingCash]=useState("");
 const [message,setMessage]=useState("");
 const [lastClosed,setLastClosed]=useState<string|null>(null);
 async function autoOpen(){
  setLoading(true);setMessage("");
  try{
   const response=await fetch("/api/pos/shifts/open",{
    method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({business_mode:"recycling"})
   });
   const body=await response.json().catch(()=>null) as Result<{shift?:ShiftInfo}>|null;
   if(response.ok && body?.data?.shift?.status==="open" &&
      recyclingShiftIsToday(body.data.shift.opened_at)){
    setShift(body.data.shift);
    setMessage("กะ Recycling ประจำวันเปิดแล้ว · ปิดอัตโนมัติเมื่อสิ้นสุดวัน (เวลาไทย)");
   }else{
    setShift(null);
    setMessage(body?.error?.message||"เปิดกะ Recycling ไม่สำเร็จ กรุณาตรวจสอบสิทธิ์");
   }
  }catch{setShift(null);setMessage("เชื่อมต่อเซิร์ฟเวอร์เปิดกะไม่ได้");}
  finally{setLoading(false);}
 }
 useEffect(()=>{
  void autoOpen();
  // On an already-open page, midnight invalidates the old shift. The
  // database worker closes it; we never close it from a browser tab.
  const openedDate={value:new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"})};
  const timer=window.setInterval(()=>{
   const today=new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"});
   if(today!==openedDate.value){openedDate.value=today;setShift(null);void autoOpen();}
  },5000);
  return ()=>window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 async function close(){
  if(!shift||closing)return;
  if(!/^\d{1,10}(\.\d{1,2})?$/.test(closingCash)){
    setMessage("กรุณานับเงินสดจริงและกรอกจำนวนบาทไม่เกินสองตำแหน่งก่อนปิดกะ");return;
  }
  setClosing(true);setMessage("");
  try{
   const response=await fetch("/api/pos/shifts/close",{
    method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({closing_cash:Number(closingCash),quick_close:false})
   });
   const body=await response.json().catch(()=>null) as Result<{shift_id?:string}>|null;
   if(!response.ok||!body?.data?.shift_id){
    setMessage(body?.error?.message??"ยังปิดกะไม่สำเร็จ ต้องตรวจสอบยอดคงเหลือและบิลที่ยังไม่ชำระ");return;
   }
   setLastClosed(body.data.shift_id);setShift(null);
   setMessage("บันทึกปิดกะแล้ว · ระบบแยกรับซื้อ/ขายออกและตรวจผลต่างเงินสดตามข้อมูลจริง");
   router.refresh();
   // Reuse the existing at-most-once automatic first print. Failure must not
   // roll back the successfully closed shift.
   try{
    const print=await fetch("/api/pos/shifts/"+encodeURIComponent(body.data.shift_id)+"/print",{
      method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({print_mode:"auto_first"})
    });
    if(!print.ok)setMessage("ปิดกะสำเร็จ แต่ไม่สามารถส่งใบสรุปอัตโนมัติ ตรวจเครื่องพิมพ์และกดพิมพ์ย้อนหลังได้");
   }catch{setMessage("ปิดกะสำเร็จ แต่ยังไม่ได้รับการยืนยันคิวพิมพ์ สามารถตรวจงานพิมพ์ย้อนหลังได้");}
  }catch{setMessage("ไม่สามารถยืนยันการปิดกะได้ กรุณาตรวจสถานะก่อนกดซ้ำ");}
  finally{setClosing(false);}
 }
 return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="recycling-shift-control">
  <div className="flex flex-wrap items-center justify-between gap-2">
   <div>
    <h2 className="text-lg font-extrabold text-slate-900">เปิด/ปิดกะประจำวัน · {branchName}</h2>
    <p className="mt-1 text-xs text-slate-500">เปิดเมื่อเข้าใช้งานจริง · ปิดกะที่เที่ยงคืนเวลาไทยโดยเซิร์ฟเวอร์ · แยกจากกะขายทั่วไป</p>
   </div>
   <span className={"rounded-full px-3 py-2 text-xs font-bold "+(shift?"bg-emerald-100 text-emerald-800":"bg-amber-100 text-amber-900")}>
    {loading?"กำลังตรวจสอบ":shift?"เปิดกะอยู่":"ไม่มีกะเปิด"}
   </span>
  </div>
  {shift&&<div className="mt-3 grid gap-3 sm:grid-cols-2">
   <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm">
    <p className="text-xs text-slate-600">เริ่มกะ</p>
    <strong>{new Date(shift.opened_at).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</strong>
    <p className="mt-1 text-xs text-slate-600">เงินสดตั้งต้น: {shift.opening_cash===null?"ยังไม่ยืนยัน":shift.opening_cash.toFixed(2)+" บาท"}</p>
   </div>
   <form onSubmit={e=>{e.preventDefault();void close();}} className="rounded-lg border border-slate-200 p-3">
    <label className="block text-xs font-bold text-slate-700">เงินสดตรวจนับจริงก่อนปิดกะ (บาท)
     <input required type="number" inputMode="decimal" step=".01" min="0" max="9999999999"
      value={closingCash} onChange={e=>setClosingCash(e.target.value)}
      placeholder="กรอกหลังนับเงินจริง" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/>
    </label>
    <button disabled={closing||loading} type="submit"
      className="mt-2 w-full rounded-lg bg-blue-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
     {closing?"กำลังปิดกะ...":"ปิดกะและพิมพ์ใบสรุป"}
    </button>
   </form>
  </div>}
  {!shift&&<button type="button" disabled={loading||closing} onClick={()=>void autoOpen()}
    className="mt-3 rounded-lg border border-blue-300 px-4 py-2 text-sm font-semibold text-blue-700 disabled:opacity-50">
    ตรวจสอบและเปิดกะประจำวันอีกครั้ง
  </button>}
  {message&&<p role="status" className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</p>}
  {lastClosed&&<div className="mt-2"><RecyclingShiftPrintButton shiftId={lastClosed}/></div>}
 </section>;
}
