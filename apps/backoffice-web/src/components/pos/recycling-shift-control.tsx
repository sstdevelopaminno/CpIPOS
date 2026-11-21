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
  const [busy,setBusy] = useState(false);
  const [openingCash,setOpeningCash] = useState("");
  const [closingCash,setClosingCash] = useState("");
  const [message,setMessage] = useState("");
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
        setShift(null);setNeedsJoin(false);
        setMessage(body?.error?.message??"ตรวจสอบสถานะกะไม่สำเร็จ");
      } else {
        const todayShift = body?.data?.shift;
        setShift(todayShift && recyclingShiftIsToday(todayShift.opened_at) ? todayShift : null);
        setNeedsJoin(Boolean(todayShift && body?.data?.needs_join));
        setMessage(body?.data?.message??"");
      }
    } catch {
      setShift(null);setNeedsJoin(false);
      setMessage("เชื่อมต่อระบบตรวจสอบกะไม่ได้ กรุณาลองอีกครั้ง");
    } finally { setLoading(false); }
  }

  useEffect(()=>{
    void loadShift();
    const day={value:recyclingBusinessDayKey(new Date())};
    const onVisibility=()=>{if(document.visibilityState==="visible") void loadShift();};
    const timer=window.setInterval(()=>{
      const today=recyclingBusinessDayKey(new Date());
      if(today!==day.value){day.value=today;setShift(null);setNeedsJoin(false);void loadShift();}
    },5000);
    document.addEventListener("visibilitychange",onVisibility);
    return ()=>{window.clearInterval(timer);document.removeEventListener("visibilitychange",onVisibility);};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  async function openShift() {
    if (busy || loading || shift) return;
    if (openingCash.trim() && !/^\\d{1,10}(\\.\\d{1,2})?$/.test(openingCash.trim())) {
      setMessage("กรุณากรอกเงินสดตั้งต้นเป็นจำนวนที่ถูกต้อง ไม่เกิน 2 ตำแหน่ง");return;
    }
    setBusy(true);setMessage("");
    try {
      const response=await fetch("/api/pos/shifts/open",{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({business_mode:"recycling",
          opening_cash:openingCash.trim()?Number(openingCash):null})
      });
      const body=await response.json().catch(()=>null) as Result<{shift?:ShiftInfo}>|null;
      if(response.ok && body?.data?.shift?.status==="open" &&
         recyclingShiftIsToday(body.data.shift.opened_at)) {
        setShift(body.data.shift);setNeedsJoin(false);
        setMessage("เปิดกะ Recycling วันนี้สำเร็จ");
        router.refresh();
      }else{
        setMessage(body?.error?.message??"เปิดกะไม่สำเร็จ กรุณาตรวจสอบสถานะกะ");
        await loadShift();
      }
    }catch{setMessage("เชื่อมต่อเซิร์ฟเวอร์เปิดกะไม่ได้");}
    finally{setBusy(false);}
  }

  async function joinShift() {
    if (!shift || !needsJoin || busy) return;
    setBusy(true);setMessage("");
    try {
      const response=await fetch("/api/pos/shifts/join",{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({shift_id:shift.id})
      });
      const body=await response.json().catch(()=>null) as Result<{shift?:ShiftInfo}>|null;
      if (!response.ok || !body?.data?.shift) {
        setMessage(body?.error?.message??"เข้าร่วมกะไม่สำเร็จ");return;
      }
      setNeedsJoin(false);setMessage("เข้าร่วมกะสำเร็จ สามารถรับซื้อ–ขายออกได้");
      router.refresh();
    }catch{setMessage("เชื่อมต่อเซิร์ฟเวอร์เข้าร่วมกะไม่ได้");}
    finally{setBusy(false);}
  }

  async function closeShift() {
    if (!shift || needsJoin || busy) return;
    if (!/^\\d{1,10}(\\.\\d{1,2})?$/.test(closingCash.trim())) {
      setMessage("กรุณานับเงินสดจริงและกรอกจำนวนบาทไม่เกินสองตำแหน่งก่อนปิดกะ");
      return;
    }
    setBusy(true);setMessage("");
    try {
      const response=await fetch("/api/pos/shifts/close",{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({closing_cash:Number(closingCash),quick_close:false})
      });
      const body=await response.json().catch(()=>null) as Result<{shift_id?:string}>|null;
      if(!response.ok||!body?.data?.shift_id) {
        setMessage(body?.error?.message??"ยังปิดกะไม่สำเร็จ ต้องตรวจสอบยอดและบิลที่ยังไม่ชำระ");
        return;
      }
      setLastClosed(body.data.shift_id);setShift(null);setNeedsJoin(false);
      setClosingCash("");
      setMessage("บันทึกปิดกะสำเร็จ · ตรวจผลต่างเงินสดตามข้อมูลที่นับจริง");
      router.refresh();
      try {
        const print=await fetch("/api/pos/shifts/"+encodeURIComponent(body.data.shift_id)+"/print",{
          method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({print_mode:"auto_first"})
        });
        if(!print.ok)setMessage("ปิดกะสำเร็จ แต่ส่งพิมพ์อัตโนมัติไม่สำเร็จ สามารถพิมพ์ย้อนหลังได้");
      }catch{setMessage("ปิดกะสำเร็จ แต่คิวพิมพ์ยังไม่ยืนยัน สามารถพิมพ์ย้อนหลังได้");}
    }catch{setMessage("ไม่สามารถยืนยันการปิดกะได้ กรุณาตรวจสถานะก่อนกดซ้ำ");}
    finally{setBusy(false);}
  }

  return <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" data-testid="recycling-shift-control">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-base font-extrabold text-slate-900">กะประจำวัน · {branchName}</h2>
        <p className="mt-1 text-xs text-slate-500">รอบวันตามเวลาไทย · ระบบปิดกะอัตโนมัติเมื่อสิ้นสุดวัน · แยกจาก POS ทั่วไป</p>
      </div>
      <span className={"rounded-full px-3 py-1.5 text-xs font-bold "+(shift?"bg-emerald-100 text-emerald-800":"bg-slate-100 text-slate-700")}>
        {loading?"กำลังตรวจสอบ":shift?needsJoin?"เปิดอยู่ · ยังไม่เข้าร่วม":"เปิดอยู่":"ยังไม่เปิดกะ"}
      </span>
    </div>
    {shift ? <div className="mt-4 grid gap-3 lg:grid-cols-2">
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm sm:grid-cols-2">
        <div><p className="text-xs font-semibold text-slate-500">เริ่มกะ</p>
          <p className="mt-1 font-bold text-slate-900">{new Date(shift.opened_at).toLocaleString("th-TH",{timeZone:"Asia/Bangkok"})}</p></div>
        <div><p className="text-xs font-semibold text-slate-500">เงินสดตั้งต้น</p>
          <p className="mt-1 font-bold text-slate-900">{shift.opening_cash===null?"ยังไม่ยืนยัน":shift.opening_cash.toFixed(2)+" บาท"}</p></div>
      </div>
      {needsJoin ? <div className="flex flex-col justify-center gap-2 rounded-xl border border-blue-100 bg-blue-50 p-4">
        <p className="text-sm text-blue-900">กะเปิดอยู่ แต่บัญชีนี้ยังไม่ได้เข้าร่วมกะของเครื่องนี้</p>
        <button type="button" disabled={busy||loading} onClick={()=>void joinShift()}
          className="rounded-lg bg-blue-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
          {busy?"กำลังเข้าร่วมกะ...":"เข้าร่วมกะนี้"}
        </button>
      </div> : <form onSubmit={event=>{event.preventDefault();void closeShift();}}
        className="rounded-xl border border-slate-200 p-4">
        <label htmlFor="recycling-closing-cash" className="block text-sm font-bold text-slate-800">เงินสดที่ตรวจนับจริง (บาท)</label>
        <p className="mb-2 text-xs text-slate-500">นับเงินสดก่อนปิดกะ ไม่รวมยอดโอนหรือเครดิต</p>
        <input id="recycling-closing-cash" required type="number" inputMode="decimal" step=".01" min="0" max="9999999999"
          value={closingCash} onChange={event=>setClosingCash(event.target.value)}
          placeholder="ระบุจำนวนเงินที่นับจริง" className="w-full rounded-lg border border-slate-300 px-3 py-3 text-sm"/>
        <button disabled={busy||loading} type="submit"
          className="mt-3 w-full rounded-lg bg-blue-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
          {busy?"กำลังปิดกะ...":"ปิดกะและพิมพ์ใบสรุป"}
        </button>
      </form>}
    </div> : <div className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-end">
      <label htmlFor="recycling-opening-cash" className="block flex-1 text-sm font-bold text-slate-800">
        เงินสดตั้งต้น (บาท) <span className="font-normal text-slate-500">หากยังไม่ยืนยันให้เว้นว่าง</span>
        <input id="recycling-opening-cash" type="number" min="0" step=".01" inputMode="decimal"
          value={openingCash} onChange={event=>setOpeningCash(event.target.value)}
          placeholder="ระบุเงินสดตั้งต้นตามจริง" className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm"/>
      </label>
      <button type="button" disabled={loading||busy} onClick={()=>void openShift()}
        className="min-h-11 rounded-lg bg-blue-700 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
        {busy?"กำลังเปิดกะ...":"เปิดกะวันนี้"}
      </button>
    </div>}
    {message && <p role="status" className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{message}</p>}
    {lastClosed && <div className="mt-3"><RecyclingShiftPrintButton shiftId={lastClosed}/></div>}
    <div className="mt-3 flex justify-end">
      <button type="button" disabled={busy||loading} onClick={()=>void loadShift()}
        className="text-xs font-semibold text-blue-700 underline-offset-2 hover:underline disabled:opacity-50">รีเฟรชสถานะกะ</button>
    </div>
  </section>;
}
