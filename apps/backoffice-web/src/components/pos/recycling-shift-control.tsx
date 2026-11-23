"use client";
import {useEffect,useState} from "react";
import {useRouter} from "next/navigation";
import {recyclingBusinessDayKey, recyclingShiftIsToday} from "@/lib/recycling-business-day";

type ShiftInfo={
  id:string;status:string;opened_at:string;opening_cash:number|null;
  fund_source?:string|null;fund_reference?:string|null;
};
type FundingSummary={
  finance_status:"restricted"|"unposted"|"ready"|"unavailable";
  accounts:Array<{code:string;label:string;balance_minor:number|null;entries:number}>;
  shift_flow_status:"not_requested"|"ready"|"unavailable";
  shift_flow:{
    opening_minor:number|null;cash_in_minor:number;cash_out_minor:number;
    expected_minor:number|null;buy_count:number;sell_count:number;
  }|null;
  note:string;
};
function minorMoney(value:number|null|undefined){
 return value===null||value===undefined||!Number.isSafeInteger(value)?"รอตรวจสอบ":
   (value/100).toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2})+" บาท";
}
type Result<T>={data?:T;error?:{code?:string;message?:string}};
export function RecyclingShiftPrintButton({shiftId,automatic=false}:{
 shiftId:string;automatic?:boolean
}){
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
 async function print(){
  if(busy)return;
  setBusy(true);setMessage("");
  window.dispatchEvent(new Event("cpi-windows-fast-print-prime"));
  try{
   const response=await fetch("/api/pos/shifts/"+encodeURIComponent(shiftId)+"/print",{
    method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({print_mode:"manual",request_id:crypto.randomUUID()})
   });
   const body=await response.json().catch(()=>null) as Result<{jobs?:Array<{id:string;status:string}>}>|null;
   if(response.ok && (body?.data?.jobs?.length??0)>0)
    window.dispatchEvent(new Event("cpi-windows-print-agent-wake"));
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
  const [lookupErrorCode,setLookupErrorCode] = useState<string|null>(null);
  const [recoveryAllowed,setRecoveryAllowed] = useState(false);
  const [recoveryCash,setRecoveryCash] = useState("");
  const [recoveryPhrase,setRecoveryPhrase] = useState("");
  const [busy,setBusy] = useState(false);
  const [openingCash,setOpeningCash] = useState("");
  const [fundSource,setFundSource] = useState<"counted_cash"|"withdrawn_cash">("counted_cash");
  const [fundReference,setFundReference] = useState("");
  const [cashCountConfirmed,setCashCountConfirmed] = useState(false);
  const [funding,setFunding] = useState<FundingSummary|null>(null);
  const [fundingLoading,setFundingLoading] = useState(false);
  const [fundingError,setFundingError] = useState("");
  const [closingCash,setClosingCash] = useState("");
  const [message,setMessage] = useState("");
  const [actionError,setActionError] = useState("");
  const [modalKind,setModalKind] = useState<"open"|"close"|"active"|"recover"|null>(null);
  const [lastClosed,setLastClosed] = useState<string|null>(null);

  async function loadShift() {
    setLoading(true);
    try {
      const response = await fetch("/api/pos/recycling/shifts/current", {
        credentials:"same-origin", cache:"no-store"
      });
      const body = await response.json().catch(()=>null) as Result<{
        shift?:ShiftInfo|null; needs_join?:boolean; message?:string; recovery_allowed?:boolean
      }>|null;
      if (!response.ok) {
        setShift(null);setNeedsJoin(false);setLookupFailed(true);
        setLookupErrorCode(body?.error?.code??"recycling_shift_lookup_failed");
        setRecoveryAllowed(Boolean(body?.data?.recovery_allowed));
        setMessage(body?.error?.message??"ตรวจสอบสถานะกะไม่สำเร็จ");
      } else {
        const current=body?.data?.shift;
        setShift(current && recyclingShiftIsToday(current.opened_at) ? current : null);
        setNeedsJoin(Boolean(current && body?.data?.needs_join));
        setLookupFailed(false);setLookupErrorCode(null);setRecoveryAllowed(false);
        setMessage(body?.data?.message??"");
      }
    } catch {
      setShift(null);setNeedsJoin(false);setLookupFailed(true);
      setLookupErrorCode("recycling_network_unavailable");setRecoveryAllowed(false);
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

  // Load verified accounting context only when the relevant modal is opened.
  // A finance GL balance is *not* automatically available in the cash drawer.
  useEffect(()=>{
    if(!modalKind||modalKind==="recover")return;
    const controller=new AbortController();
    async function readFunding(){
      setFunding(null);setFundingError("");setFundingLoading(true);
      try{
        const param=shift?.id?"?shiftId="+encodeURIComponent(shift.id):"";
        const resp=await fetch("/api/pos/recycling/funding/summary"+param,{
          credentials:"same-origin",cache:"no-store",signal:controller.signal
        });
        const body=await resp.json().catch(()=>null) as Result<FundingSummary>|null;
        if(!resp.ok||!body?.data)throw new Error(body?.error?.message??"อ่านข้อมูลเงินทุนไม่ได้");
        if(!controller.signal.aborted)setFunding(body.data);
      }catch(error){
        if(!controller.signal.aborted)setFundingError(error instanceof Error?error.message:"อ่านข้อมูลเงินทุนไม่ได้");
      }finally{if(!controller.signal.aborted)setFundingLoading(false);}
    }
    void readFunding();
    return ()=>controller.abort();
  },[modalKind,shift?.id]);

  function showModal(kind:"open"|"close"|"active"|"recover"){
    if(loading || busy)return;
    if(kind==="open")setCashCountConfirmed(false);
    // Allow the cashier to inspect the reason for a blocked shift. Never
    // enable a financial mutation while a conflicting POS shift is open.
    setActionError(lookupFailed && kind!=="recover" ? message : "");
    setModalKind(kind);
  }

  async function recoverLegacyShift() {
    if (busy || loading || !recoveryAllowed ||
        lookupErrorCode!=="recycling_existing_legacy_shift_requires_review") return;
    if (recoveryCash.trim()!=="0.00" || recoveryPhrase.trim()!=="ยืนยันกู้คืนกะ") {
      setActionError("กรุณาตรวจนับว่าเงินสดจริงเป็น 0.00 บาท และพิมพ์ ยืนยันกู้คืนกะ");
      return;
    }
    setBusy(true);setActionError("");
    try {
      const response=await fetch("/api/pos/recycling/shifts/recover",{
        method:"POST",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({counted_cash:0,confirmation:"ยืนยันกู้คืนกะ"})
      });
      const body=await response.json().catch(()=>null) as Result<{
        shift_id?:string;business_shift_mode?:string;message?:string
      }>|null;
      if (!response.ok || !body?.data?.shift_id ||
          body?.data?.business_shift_mode!=="recycling_daily") {
        setActionError(body?.error?.message??"ไม่สามารถกู้คืนกะได้ ต้องให้ฝ่าย IT ตรวจสอบข้อมูลกะ");
        return;
      }
      setRecoveryCash("");setRecoveryPhrase("");
      setModalKind(null);setMessage("กู้คืนกะ Recycling สำเร็จ เปิดรับซื้อ–ขายออกได้แล้ว");
      setLookupFailed(false);setLookupErrorCode(null);setRecoveryAllowed(false);
      await loadShift();
      router.refresh();
    } catch {
      setActionError("เชื่อมต่อระบบกู้คืนกะไม่สำเร็จ กรุณารีเฟรชสถานะก่อนลองอีกครั้ง");
    } finally {setBusy(false);}
  }

  async function openShift() {
    if(busy||loading||lookupFailed||shift)return;
    if(!/^\d{1,8}(\.\d{1,2})?$/.test(openingCash.trim())||!cashCountConfirmed){
      setActionError("กรุณาระบุเงินทุนรับซื้อที่ตรวจนับได้จริง (ระบุ 0.00 ได้) และทำเครื่องหมายยืนยันยอด");
      return;
    }
    if(fundSource==="withdrawn_cash" && fundReference.trim().length<3){
      setActionError("กรุณาระบุเลขที่เอกสารเบิกเงินหรือหลักฐานรับเงินสดจากบัญชีก่อนเปิดกะ");
      return;
    }
    setBusy(true);setActionError("");
    try {
      const response=await fetch("/api/pos/shifts/open",{
        method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({business_mode:"recycling",
          opening_cash:Number(openingCash),fund_source:fundSource,
          fund_reference:fundSource==="withdrawn_cash"?fundReference.trim():"",
          cash_count_confirmed:cashCountConfirmed})
      });
      const body=await response.json().catch(()=>null) as Result<{shift?:ShiftInfo}>|null;
      if(response.ok&&body?.data?.shift?.status==="open"&&
         recyclingShiftIsToday(body.data.shift.opened_at)){
        setShift(body.data.shift);setNeedsJoin(false);
        setMessage("เปิดกะพร้อมเงินทุนรับซื้อที่ตรวจนับจริงแล้ว (ยังไม่ใช่การโอนเงินจากบัญชี)");
        setModalKind(null);setOpeningCash("");setCashCountConfirmed(false);setFundReference("");
        // Opening slip is an optional, idempotent Windows-only print AFTER
        // the persisted opening cash/shift commit. Never retry the shift POST.
        window.dispatchEvent(new Event("cpi-windows-fast-print-prime"));
        void fetch("/api/pos/recycling/shifts/"+encodeURIComponent(body.data.shift.id)+"/open-print",{
          method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
          body:"{}",keepalive:true
        }).then(async printed=>{
          const result=await printed.json().catch(()=>null) as Result<{
            jobs?:Array<{id:string;status:string;fast_wake?:boolean}>;skipped?:boolean
          }>|null;
          if(printed.ok && result?.data?.jobs?.some(job=>job.fast_wake===true && job.status==="pending"))
            window.dispatchEvent(new Event("cpi-windows-print-agent-wake"));
          else if(!printed.ok)console.warn("[recycling-shift-open] confirmed shift; optional printer queue unavailable");
        }).catch(()=>console.warn("[recycling-shift-open] optional print request unavailable"));
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
        body:JSON.stringify({shift_id:shift.id,business_mode:"recycling"})
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
        body:JSON.stringify({shift_id:shift.id,business_mode:"recycling",closing_cash:Number(closingCash),quick_close:false})
      });
      const body=await response.json().catch(()=>null) as Result<{shift_id?:string}>|null;
      if(!response.ok||!body?.data?.shift_id){
        setActionError(body?.error?.message??"ปิดกะไม่สำเร็จ กรุณาตรวจยอดและบิลค้าง");
        return;
      }
      setLastClosed(body.data.shift_id);
      setShift(null);setNeedsJoin(false);setClosingCash("");
      setModalKind(null);
      setMessage("ปิดกะเงินทุนรับซื้อสำเร็จ · ระบบบันทึกยอดเงินสดคงเหลือที่ตรวจนับจริงแล้ว");
      router.refresh();
      try {
        window.dispatchEvent(new Event("cpi-windows-fast-print-prime"));
        const print=await fetch("/api/pos/shifts/"+encodeURIComponent(body.data.shift_id)+"/print",{
          method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({print_mode:"auto_first"})
        });
        if(!print.ok){
          setMessage("ปิดกะสำเร็จ แต่ส่งพิมพ์อัตโนมัติไม่สำเร็จ สามารถพิมพ์ย้อนหลังได้");
        }else{
          const printed=await print.json().catch(()=>null) as Result<{
            jobs?:Array<{id:string;status:string}>
          }>|null;
          if((printed?.data?.jobs?.length??0)>0)
            window.dispatchEvent(new Event("cpi-windows-print-agent-wake"));
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
          <h2 className="text-base font-extrabold text-slate-900">เงินทุนหมุนเวียนรับซื้อ · {branchName}</h2>
          <span className={"rounded-full px-3 py-1 text-xs font-bold "+(
            hasShift?"bg-emerald-100 text-emerald-800":"bg-slate-100 text-slate-700")}>
            {loading?"กำลังตรวจสอบ":lookupFailed?lookupErrorCode==="recycling_existing_legacy_shift_requires_review"?"มีกะต่างประเภทเปิดอยู่":"ตรวจสอบไม่สำเร็จ":hasShift?"เปิดอยู่":"ยังไม่เปิดกะ"}
          </span>
        </div>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          ใช้เงินสดรับซื้อวัสดุจากลูกค้า · ขายออกจะเพิ่มเงินสดเฉพาะเมื่อรับชำระเงินจริง · กระทบยอดทุกสิ้นวัน
        </p>
      </div>
      <div className="flex flex-wrap gap-2" data-testid="recycling-shift-actions">
        <button type="button" onClick={()=>showModal("active")}
          disabled={loading||busy}
          className="min-h-10 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">
          ดูเงินทุนกะนี้
        </button>
        <button type="button" onClick={()=>showModal("open")}
          disabled={loading||busy||hasShift||lookupFailed}
          className="min-h-10 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          เปิดกะรับซื้อ
        </button>
        {recoveryAllowed && lookupErrorCode==="recycling_existing_legacy_shift_requires_review" &&
          <button type="button" data-testid="recycling-recover-legacy-button"
            disabled={loading||busy} onClick={()=>showModal("recover")}
            className="min-h-10 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-bold text-amber-900 disabled:opacity-50">
            ตรวจสอบและกู้คืนกะ
          </button>}
        <button type="button" onClick={()=>showModal("close")}
          disabled={loading||busy||(!hasShift&&!lookupFailed)||needsJoin}
          className="min-h-10 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          ปิดกะ / ตรวจนับ
        </button>
      </div>
    </div>
    {message && (!shift || message !== "กะ Recycling เปิดแล้ว") && <p role={lookupFailed?"alert":"status"}
      className={"mt-2 text-xs "+(lookupFailed?"font-semibold text-amber-800":"text-slate-600")}>{message}</p>}
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
      <section className="relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold tracking-wider text-blue-700">CUSTOM · RECYCLING</p>
            <h3 id="recycling-shift-modal-title" className="mt-1 text-xl font-extrabold text-slate-900">
              {modalKind==="open"?"เปิดกะ · ตั้งทุนรับซื้อประจำวัน":modalKind==="close"?"ปิดกะ · กระทบยอดเงินทุน":modalKind==="recover"?"ตรวจสอบและกู้คืนกะ Recycling":"เงินทุนและกระแสเงินสดกะปัจจุบัน"}
            </h3>
          </div>
          <button type="button" aria-label="ปิดหน้าต่าง" disabled={busy}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-bold text-slate-600 disabled:opacity-50"
            onClick={()=>setModalKind(null)}>✕</button>
        </div>
        <p id="recycling-shift-modal-desc" className="mt-2 text-sm leading-6 text-slate-600">
          {modalKind==="open"
            ?"กำหนดทุนรับซื้อจากเงินสดที่ได้รับจริงก่อนเริ่มจ่ายซื้อวัสดุ (ไม่ใช่เงินทอน) ระบบไม่หักเงินจากบัญชีธนาคารโดยอัตโนมัติ"
            :modalKind==="close"
            ?"เทียบทุนที่เปิดกะกับเงินสดจ่ายรับซื้อ เงินสดรับจากการขายออก และยอดที่นับได้จริงก่อนปิดกะ"
            :modalKind==="recover"
            ?"เฉพาะกรณีกะ POS ทั่วไปถูกเปิดผิดโดยระบบเดิม ไม่มีรายการซื้อขาย และนับเงินสดได้ศูนย์บาทเท่านั้น"
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
              <span className="text-slate-500">ทุนเงินสดเปิดกะ</span>
              <strong className="text-right text-slate-900">{formatCash(shift.opening_cash)}</strong>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">ที่มาเงินทุน</span>
              <strong className="text-right text-slate-900">{shift.fund_source==="withdrawn_cash"?"เบิกเงินสดจากบัญชีแล้ว":shift.fund_source==="counted_cash"?"เงินสดที่นับรับมอบ":"ข้อมูลกะเดิม (ไม่ระบุ)"}</strong>
            </div>
            {shift.fund_reference&&<div className="flex justify-between gap-3">
              <span className="text-slate-500">เลขที่เอกสารอ้างอิง</span>
              <strong className="break-all text-right text-slate-900">{shift.fund_reference}</strong>
            </div>}
          </>}
        </div>

        {modalKind!=="recover"&&<section className="mt-4 rounded-lg border border-blue-200 bg-blue-50/70 p-3 sm:p-4"
          data-testid="recycling-funding-ledger-panel">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="text-sm font-extrabold text-blue-950">เชื่อมข้อมูลบัญชีเงินทุน · อ่านอย่างเดียว</h4>
            <span className="text-[11px] font-semibold text-blue-800">{fundingLoading?"กำลังตรวจสอบ...":funding?.finance_status==="ready"?"มีรายการบัญชี":funding?.finance_status==="restricted"?"จำกัดตามสิทธิ์":"ยังไม่มีข้อมูลยืนยัน"}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {(["1100","1110"] as const).map(code=>{
              const account=funding?.accounts.find(item=>item.code===code);
              return <div key={code} className="min-w-0 rounded-lg border border-blue-100 bg-white p-3">
                <p className="font-semibold text-slate-600">{code==="1100"?"เงินสดตามบัญชี (1100)":"เงินฝากธนาคาร (1110)"}</p>
                <strong className="mt-1 block text-base font-extrabold tabular-nums text-slate-900">
                  {funding?.finance_status==="ready"?minorMoney(account?.balance_minor):"ยังไม่ยืนยัน"}
                </strong>
                <p className="mt-1 text-[11px] text-slate-500">{code==="1110"?"ไม่ใช่เงินสดที่จ่ายซื้อได้ทันที":"อ้างอิงสมุดรายวันที่โพสต์ของสาขา"}</p>
              </div>;
            })}
          </div>
          <p className="mt-2 text-xs leading-5 text-blue-900">
            {fundingError||"ยอดจากบัญชีใช้ตรวจสอบกับฝ่ายบัญชีเท่านั้น ไม่ดึงยอดมาเป็นทุนเปิดกะอัตโนมัติ ต้องเบิกเงินและนับเงินจริงก่อน"}
          </p>
        </section>}
        {(modalKind==="active"||modalKind==="close")&&shift&&<section className="mt-3 rounded-lg border border-slate-200 bg-white p-3 sm:p-4"
          data-testid="recycling-shift-cash-flow">
          <h4 className="mb-3 text-sm font-extrabold text-slate-900">สรุปเงินสดรับ–จ่ายในกะนี้</h4>
          {funding?.shift_flow_status==="ready"&&funding.shift_flow?<>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-md bg-slate-50 p-2"><p className="text-xs text-slate-500">ทุนเปิดกะ</p><strong className="text-sm tabular-nums">{minorMoney(funding.shift_flow.opening_minor)}</strong></div>
              <div className="rounded-md bg-rose-50 p-2"><p className="text-xs text-rose-700">เงินสดจ่ายรับซื้อ</p><strong className="text-sm tabular-nums text-rose-800">− {minorMoney(funding.shift_flow.cash_out_minor)}</strong></div>
              <div className="rounded-md bg-emerald-50 p-2"><p className="text-xs text-emerald-700">เงินสดรับขายออก</p><strong className="text-sm tabular-nums text-emerald-800">+ {minorMoney(funding.shift_flow.cash_in_minor)}</strong></div>
              <div className="rounded-md bg-blue-50 p-2"><p className="text-xs text-blue-800">คงเหลือตามระบบ</p><strong className="text-sm tabular-nums text-blue-900">{minorMoney(funding.shift_flow.expected_minor)}</strong></div>
            </div>
            <p className="mt-2 text-xs text-slate-500">รับซื้อ {funding.shift_flow.buy_count} บิล · ขายออก {funding.shift_flow.sell_count} บิล · ไม่รวมเงินโอนที่ยังไม่ผ่านการตรวจสอบ</p>
          </>:<p className="text-xs text-amber-800">ยังตรวจสอบยอดเงินสดจากทะเบียนธุรกรรมไม่ได้ กรุณาตรวจสอบก่อนปิดกะ</p>}
        </section>}
        {modalKind==="open"&&!lookupFailed&&<form id="recycling-open-shift-form" className="mt-4 space-y-3"
          onSubmit={event=>{event.preventDefault();void openShift();}}>
          <div>
            <label htmlFor="recycling-fund-source" className="block text-sm font-bold text-slate-800">ที่มาของทุนรับซื้อ</label>
            <select id="recycling-fund-source" value={fundSource} disabled={busy}
              onChange={event=>{setFundSource(event.target.value as "counted_cash"|"withdrawn_cash");setCashCountConfirmed(false);}}
              className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
              <option value="counted_cash">เงินสดคงเหลือ / เงินสดที่ส่งมอบให้นับแล้ว</option>
              <option value="withdrawn_cash">เงินสดที่เบิกจากบัญชีและได้รับจริงแล้ว</option>
            </select>
          </div>
          {fundSource==="withdrawn_cash"&&<div>
            <label htmlFor="recycling-fund-reference" className="block text-sm font-bold text-slate-800">เลขที่หลักฐานการเบิกเงิน / ใบรับเงินสด</label>
            <input id="recycling-fund-reference" type="text" maxLength={80} required
              disabled={busy} value={fundReference} onChange={event=>setFundReference(event.target.value)}
              placeholder="อ้างอิงเอกสารการเบิกเงินที่มีอยู่จริง"
              className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm"/>
            <p className="mt-1 text-xs text-amber-800">เลขอ้างอิงนี้ยังไม่ได้เท่ากับการอนุมัติรายการบัญชี ต้องให้ฝ่ายบัญชีกระทบยอด</p>
          </div>}
          <div>
            <label htmlFor="recycling-opening-cash" className="block text-sm font-bold text-slate-800">
              เงินทุนสดที่ได้รับและนับจริง (บาท)
            </label>
            <p className="mt-1 text-xs text-slate-500">ระบุยอดเงินสดพร้อมจ่ายรับซื้อจริงเท่านั้น · หากไม่มีเงินสดให้กรอก 0.00</p>
            <input id="recycling-opening-cash" type="number" min="0" max="99999999.99" required step=".01" inputMode="decimal"
              autoFocus disabled={busy} value={openingCash}
              onChange={event=>{setOpeningCash(event.target.value);setCashCountConfirmed(false);}}
              placeholder="เช่น 5000.00"
              className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-3 text-base font-bold tabular-nums disabled:opacity-50"/>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            <input type="checkbox" checked={cashCountConfirmed} disabled={busy}
              onChange={event=>setCashCountConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0"/>
            <span>ยืนยันว่าตรวจนับและได้รับเงินสดจำนวนนี้แล้วจริง ไม่ใช่ยอดในบัญชีธนาคารหรือวงเงินคาดการณ์</span>
          </label>
        </form>}
        {modalKind==="close"&&!lookupFailed&&shift&&<form id="recycling-close-shift-form" className="mt-4"
          onSubmit={event=>{event.preventDefault();void closeShift();}}>
          <label htmlFor="recycling-closing-cash" className="block text-sm font-semibold text-slate-800">
            เงินสดคงเหลือที่ตรวจนับจริง (บาท)
          </label>
          <p className="mt-1 text-xs text-slate-500">นับเงินสดในกองทุนรับซื้อหลังจ่ายผู้ขายวัสดุแล้ว ไม่รวมเงินฝากธนาคาร เงินโอน หรือยอดลูกหนี้โรงงาน</p>
          <input id="recycling-closing-cash" type="number" required min="0" step=".01" inputMode="decimal"
            autoFocus disabled={busy} value={closingCash} onChange={event=>setClosingCash(event.target.value)}
            placeholder="กรอกยอดเงินสดจริงก่อนปิดกะ"
            className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 py-3 text-sm disabled:opacity-50"/>
        </form>}
        {modalKind==="recover" && recoveryAllowed && <form id="recycling-recover-shift-form"
          className="mt-4 space-y-3" onSubmit={event=>{event.preventDefault();void recoverLegacyShift();}}>
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-900">
            ต้องนับเงินสดจริงก่อนยืนยัน ห้ามใช้การกู้คืนนี้หากมียอดค้างหรือเงินสดมากกว่า 0 บาท
            ประวัติกะ Recycling ที่ถูกปิดจะถูกเก็บไว้ และจะเปิดกะใหม่พร้อมบันทึกเหตุผลการกู้คืน
          </p>
          <label className="block text-sm font-semibold text-slate-800" htmlFor="recycling-recover-count">
            เงินสดที่นับได้จริง (บาท)
            <input id="recycling-recover-count" value={recoveryCash}
              onChange={event=>setRecoveryCash(event.target.value)}
              placeholder="พิมพ์ 0.00 หลังตรวจนับเงินจริง" type="text" autoComplete="off"
              disabled={busy}
              className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm"/>
          </label>
          <label className="block text-sm font-semibold text-slate-800" htmlFor="recycling-recover-phrase">
            พิมพ์ ยืนยันกู้คืนกะ
            <input id="recycling-recover-phrase" value={recoveryPhrase}
              onChange={event=>setRecoveryPhrase(event.target.value)}
              placeholder="ยืนยันกู้คืนกะ" autoComplete="off" disabled={busy}
              className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm"/>
          </label>
        </form>}
        {actionError&&<p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
          {actionError}
        </p>}
        {lookupFailed && modalKind!=="recover" && <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          กะ Recycling ไม่สามารถเปิดหรือปิดขณะนี้ได้ ระบบจะไม่ปิดกะ POS ทั่วไปแทน
          และไม่แก้ไขข้อมูลเงินสดหรือบิลอัตโนมัติ ให้ผู้จัดการตรวจสอบกะที่ค้างก่อน
        </p>}
        {lookupFailed && modalKind!=="recover" && <button type="button" disabled={loading||busy}
          onClick={()=>{setModalKind(null);void loadShift();}}
          className="mt-2 rounded-lg border border-amber-300 px-3 py-2 text-xs font-bold text-amber-900 disabled:opacity-50">
          ตรวจสอบสถานะอีกครั้ง
        </button>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={()=>setModalKind(null)} disabled={busy}
            className="min-h-10 rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">
            {modalKind==="active"?"ปิดหน้าต่าง":"ยกเลิก"}
          </button>
          {modalKind==="recover"&&<button type="submit" form="recycling-recover-shift-form"
            disabled={loading||busy||!recoveryAllowed||recoveryCash.trim()!=="0.00"||
              recoveryPhrase.trim()!=="ยืนยันกู้คืนกะ"}
            className="min-h-10 rounded-xl bg-amber-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy?"กำลังกู้คืนกะ...":"ยืนยันกู้คืนกะ"}
          </button>}
          {modalKind==="open"&&<button type="submit" form="recycling-open-shift-form" disabled={busy||loading||lookupFailed||hasShift}
            className="min-h-10 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy?"กำลังเปิดกะ...":"ยืนยันทุนเงินสดและเปิดกะ"}
          </button>}
          {modalKind==="close"&&<button type="submit" form="recycling-close-shift-form"
            disabled={busy||loading||lookupFailed||!hasShift||needsJoin}
            className="min-h-10 rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            {busy?"กำลังปิดกะ...":"ยืนยันตรวจนับ · ปิดกะและพิมพ์สรุป"}
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
