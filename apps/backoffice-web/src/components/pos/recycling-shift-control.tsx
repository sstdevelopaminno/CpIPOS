"use client";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {recyclingBusinessDayKey, recyclingShiftIsToday} from "@/lib/recycling-business-day";

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
export function RecyclingShiftControl({branchName}: {branchName:string}) {
  const router = useRouter();
  const [shift,setShift] = useState<ShiftInfo|null>(null);
  const [needsJoin,setNeedsJoin] = useState(false);
  const [loading,setLoading] = useState(true);
  const [lookupFailed,setLookupFailed] = useState(false);
  const [busy,setBusy] = useState(false);
  const [openingCash,setOpeningCash] = useState("");
  const [closingCash,setClosingCash] = useState("");
  const [message,setMessage] = useState("");
  const [actionError,setActionError] = useState("");
  const [modalKind,setModalKind] = useState<"open"|"close"|"active"|null>(null);
  const [lastClosed,setLastClosed] = useState<string|null>(null);

  async function loadShift() {
    setLoading(true);
    try {
      const response = await fetch("/api/pos/recycling/shifts/current", {
        credentials:"same-origin", cache:"no-store"
      });
      const body = await response.json().catch(()=>null) as Result<{
        shift?:ShiftInfo|null; needs_join?:boolean; message?:string
      }>|null;
      if (!response.ok) {
        setShift(null);setNeedsJoin(false);setLookupFailed(true);
        setMessage(body?.error?.message??"ตรวจสอบสถานะกะไม่สำเร็จ");
      } else {
        const current=body?.data?.shift;
        setShift(current && recyclingShiftIsToday(current.opened_at) ? current : null);
        setNeedsJoin(Boolean(current && body?.data?.needs_join));
        setLookupFailed(false);
        setMessage(body?.data?.message??"");
      }
    } catch {
      setShift(null);setNeedsJoin(false);setLookupFailed(true);
      setMessage("ไม่สามารถเชื่อมต่อระบบตรวจสอบกะได้ กรุณารีเฟรชสถานะ");
    } finally {setLoading(false);}
  }

  useEffect(()=>{
    void loadShift();
    const day={value:recyclingBusinessDayKey(new Date())};
    const onVisibility=()=>{if(document.visibilityState==="visible")void loadShift();};
    const timer=window.setInterval(()=>{
      const today=recyclingBusinessDayKey(new Date());
      if(today!==day.value){
        day.value=today;
        setShift(null);setNeedsJoin(false);setModalKind(null);void loadShift();
      }
    },5000);
    document.addEventListener("visibilitychange",onVisibility);
    return ()=>{
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange",onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  useEffect(()=>{
    if(!modalKind)return;
    function onEscape(event:KeyboardEvent){
      if(event.key==="Escape" && !busy)setModalKind(null);
    }
    document.addEventListener("keydown",onEscape);
    return ()=>document.removeEventListener("keydown",onEscape);
  },[modalKind,busy]);

  function showModal(kind:"open"|"close"|"active"){
    if(loading || lookupFailed || busy)return;
    setActionError("");
    setModalKind(kind);
  }

  async function openShift() {
    if(busy||loading||lookupFailed||shift)return;
    if(openingCash.trim() && !/^\d{1,10}(\.\d{1,2})?$/.test(openingCash.trim())){
      setActionError("กรุณาระบุเงินสดตั้งต้นให้ถูกต้อง ไม่เกินสองตำแหน่ง");
      return;
    }
    setBusy(true);setActionError("");
    try {
      const response=await fetch("/api/pos/shifts/open",{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({business_mode:"recycling",
          opening_cash:openingCash.trim()?Number(openingCash):null})
      });
      const body=await response.json().catch(()=>null) as Result<{shift?:ShiftInfo}>|null;
      if(response.ok&&body?.data?.shift?.status==="open"&&
         recyclingShiftIsToday(body.data.shift.opened_at)){
        setShift(body.data.shift);setNeedsJoin(false);
        setMessage("เปิดกะ Recycling วันนี้สำเร็จ");
        setModalKind(null);setOpeningCash("");
        router.refresh();
      } else {
        setActionError(body?.error?.message??"เปิดกะไม่สำเร็จ กรุณาตรวจสอบสิทธิ์และกะที่เปิดค้าง");
      }
    }catch{
      setActionError("ไม่สามารถยืนยันการเปิดกะได้ กรุณาตรวจสอบสถานะก่อนลองซ้ำ");
    }finally{setBusy(false);}
  }

  async function joinShift() {
    if(!shift||!needsJoin||busy||lookupFailed)return;
    setBusy(true);setActionError("");
    try {
      const response=await fetch("/api/pos/shifts/join",{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({shift_id:shift.id})
      });
      const body=await response.json().catch(()=>null) as Result<{shift?:ShiftInfo}>|null;
      if(!response.ok||!body?.data?.shift){
        setActionError(body?.error?.message??"เข้าร่วมกะไม่สำเร็จ");
        return;
      }
      setNeedsJoin(false);
      setMessage("เข้าร่วมกะแล้ว สามารถกลับไปทำรายการรับซื้อ–ขายออกได้");
      setModalKind(null);
      router.refresh();
    }catch{setActionError("ไม่สามารถยืนยันการเข้าร่วมกะได้");}
    finally{setBusy(false);}
  }

  async function closeShift() {
    if(!shift||needsJoin||busy||lookupFailed)return;
    if(!/^\d{1,10}(\.\d{1,2})?$/.test(closingCash.trim())){
      setActionError("กรุณานับเงินสดจริงก่อนปิดกะ แล้วระบุจำนวนบาทไม่เกินสองตำแหน่ง");
      return;
    }
    setBusy(true);setActionError("");
    try {
      const response=await fetch("/api/pos/shifts/close",{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({closing_cash:Number(closingCash),quick_close:false})
      });
      const body=await response.json().catch(()=>null) as Result<{shift_id?:string}>|null;
      if(!response.ok||!body?.data?.shift_id){
        setActionError(body?.error?.message??"ปิดกะไม่สำเร็จ กรุณาตรวจยอดและบิลค้าง");
        return;
      }
      setLastClosed(body.data.shift_id);
      setShift(null);setNeedsJoin(false);setClosingCash("");
      setModalKind(null);
      setMessage("ปิดกะสำเร็จ · ระบบบันทึกผลตรวจนับเงินสดจริงแล้ว");
      router.refresh();
      try {
        const print=await fetch("/api/pos/shifts/"+encodeURIComponent(body.data.shift_id)+"/print",{
          method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({print_mode:"auto_first"})
        });
        if(!print.ok){
          setMessage("ปิดกะสำเร็จ แต่ส่งพิมพ์อัตโนมัติไม่สำเร็จ สามารถพิมพ์ย้อนหลังได้");
        }
      }catch{
        setMessage("ปิดกะสำเร็จ แต่คิวพิมพ์ยังไม่ยืนยัน สามารถพิมพ์ย้อนหลังได้");
      }
    }catch{
      setActionError("ยังไม่สามารถยืนยันผลการปิดกะได้ กรุณาตรวจสอบสถานะก่อนกดซ้ำ");
    }finally{setBusy(false);}
  }

  const hasShift=Boolean(shift);
  const formatCash=(value:number|null)=>value===null?"ยังไม่ยืนยัน":value.toLocaleString("th-TH",{
    minimumFractionDigits:2,maximumFractionDigits:2
  })+" บาท";

  return <section className="w-full shrink-0 border-b border-slate-200 bg-white px-4 py-3"
    data-testid="recycling-shift-control">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-extrabold text-slate-900">กะ Recycling · {branchName}</h2>
          <span className={"rounded-full px-3 py-1 text-xs font-bold "+(
            hasShift?"bg-emerald-100 text-emerald-800":"bg-slate-100 text-slate-700")}>
            {loading?"กำลังตรวจสอบ":lookupFailed?"ตรวจสอบไม่สำเร็จ":hasShift?"เปิดอยู่":"ยังไม่เปิดกะ"}
          </span>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          กะรายวันตามเวลาไทย · ปิดอัตโนมัติเมื่อสิ้นสุดวัน · แยกจากกะของ POS หลัก
        </p>
      </div>
      <div className="flex flex-wrap gap-2" data-testid="recycling-shift-actions">
        <button type="button" onClick={()=>showModal("active")}
          disabled={loading||lookupFailed||busy}
          className="min-h-10 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">
          ดูกะปัจจุบัน
        </button>
        <button type="button" onClick={()=>showModal("open")}
          disabled={loading||lookupFailed||busy||hasShift}
          className="min-h-10 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          เปิดกะทันที
        </button>
        <button type="button" onClick={()=>showModal("close")}
          disabled={loading||lookupFailed||busy||!hasShift||needsJoin}
          className="min-h-10 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          ปิดกะตอนนี้
        </button>
      </div>
    </div>
    {message && (!shift || message !== "กะ Recycling เปิดแล้ว") && <p role="status" className="mt-2 text-xs text-slate-600">{message}</p>}
    <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
      {lastClosed?<RecyclingShiftPrintButton shiftId={lastClosed}/>:<span className="text-xs text-slate-500">
        {shift?"กะเริ่ม "+new Date(shift.opened_at).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"}):"ยังไม่มีกะที่เปิดในเครื่องนี้"}
      </span>}
      <button type="button" disabled={busy||loading} onClick={()=>void loadShift()}
        className="text-xs font-semibold text-blue-700 hover:underline disabled:opacity-50">
        รีเฟรชสถานะกะ
      </button>
    </div>

    {modalKind&&<div className="fixed inset-0 z-[170] flex items-center justify-center overflow-y-auto p-3 sm:p-5"
      data-testid="recycling-shift-popup" role="dialog" aria-modal="true"
      aria-labelledby="recycling-shift-modal-title" aria-describedby="recycling-shift-modal-desc">
      <button type="button" aria-label="ปิดหน้าต่าง"
        disabled={busy} onClick={()=>setModalKind(null)}
        className="absolute inset-0 cursor-default bg-slate-950/55 disabled:cursor-wait" />
      <section className="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-wider text-blue-700">CUSTOM · RECYCLING</p>
            <h3 id="recycling-shift-modal-title" className="mt-1 text-xl font-extrabold text-slate-900">
              {modalKind==="open"?"เปิดกะประจำวัน":modalKind==="close"?"ยืนยันปิดกะ":"รายละเอียดกะปัจจุบัน"}
            </h3>
          </div>
          <button type="button" aria-label="ปิดหน้าต่าง" disabled={busy}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-bold text-slate-600 disabled:opacity-50"
            onClick={()=>setModalKind(null)}>✕</button>
        </div>
        <p id="recycling-shift-modal-desc" className="mt-2 text-sm leading-6 text-slate-600">
          {modalKind==="open"
            ?"ยืนยันเงินสดตั้งต้นตามยอดที่ตรวจนับจริง ระบบจะเปิดกะเฉพาะเครื่องและสาขานี้"
            :modalKind==="close"
            ?"ตรวจนับเงินสดจริงก่อนปิดกะ ใบสรุปจะส่งเข้าคิวพิมพ์หลังปิดกะสำเร็จ"
            :"รายละเอียดเฉพาะกะ Recycling ไม่รวมกะขายทั่วไป"}
        </p>
        <div className="mt-4 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <div className="flex justify-between gap-3">
            <span className="text-slate-500">สาขา</span><strong className="text-right text-slate-900">{branchName}</strong>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-slate-500">สถานะ</span><strong className="text-right text-slate-900">
              {shift?needsJoin?"เปิดแล้ว · ยังไม่เข้าร่วม":"เปิดกะอยู่":"ยังไม่เปิดกะ"}
            </strong>
          </div>
          {shift&&<>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">เวลาเปิด</span>
              <strong className="text-right text-slate-900">{new Date(shift.opened_at).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</strong>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">เงินสดตั้งต้น</span>
              <strong className="text-right text-slate-900">{formatCash(shift.opening_cash)}</strong>
            </div>
          </>}
        </div>

        {modalKind==="open"&&<form id="recycling-open-shift-form" className="mt-4"
          onSubmit={event=>{event.preventDefault();void openShift();}}>
          <label htmlFor="recycling-opening-cash" className="block text-sm font-semibold text-slate-800">
            เงินสดตั้งต้น (บาท)
          </label>
          <p className="mt-1 text-xs text-slate-500">เว้นว่างได้หากยังไม่ยืนยันยอด ไม่บันทึกเป็นศูนย์โดยอัตโนมัติ</p>
          <input id="recycling-opening-cash" type="number" min="0" step=".01" inputMode="decimal"
            autoFocus disabled={busy} value={openingCash} onChange={event=>setOpeningCash(event.target.value)}
            placeholder="ระบุยอดเงินสดตั้งต้นตามจริง"
            className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm disabled:opacity-50"/>
        </form>}
        {modalKind==="close"&&<form id="recycling-close-shift-form" className="mt-4"
          onSubmit={event=>{event.preventDefault();void closeShift();}}>
          <label htmlFor="recycling-closing-cash" className="block text-sm font-semibold text-slate-800">
            เงินสดที่ตรวจนับจริง (บาท)
          </label>
          <p className="mt-1 text-xs text-slate-500">กรอกยอดที่นับจริง ไม่รวมเงินโอนหรือยอดเครดิต</p>
          <input id="recycling-closing-cash" type="number" required min="0" step=".01" inputMode="decimal"
            autoFocus disabled={busy} value={closingCash} onChange={event=>setClosingCash(event.target.value)}
            placeholder="กรอกยอดเงินสดจริงก่อนปิดกะ"
            className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm disabled:opacity-50"/>
        </form>}
        {actionError&&<p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
          {actionError}
        </p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={()=>setModalKind(null)} disabled={busy}
            className="min-h-10 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">
            {modalKind==="active"?"ปิดหน้าต่าง":"ยกเลิก"}
          </button>
          {modalKind==="open"&&<button type="submit" form="recycling-open-shift-form" disabled={busy||loading||lookupFailed||hasShift}
            className="min-h-10 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy?"กำลังเปิดกะ...":"ยืนยันเปิดกะ"}
          </button>}
          {modalKind==="close"&&<button type="submit" form="recycling-close-shift-form"
            disabled={busy||loading||lookupFailed||!hasShift||needsJoin}
            className="min-h-10 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy?"กำลังปิดกะ...":"ยืนยันปิดกะและพิมพ์ใบสรุป"}
          </button>}
          {modalKind==="active"&&needsJoin&&shift&&<button type="button" disabled={busy||loading||lookupFailed}
            onClick={()=>void joinShift()}
            className="min-h-10 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy?"กำลังเข้าร่วมกะ...":"เข้าร่วมกะนี้"}
          </button>}
        </div>
      </section>
    </div>}
  </section>;
}
