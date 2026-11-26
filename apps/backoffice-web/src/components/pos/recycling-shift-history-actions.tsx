"use client";
import {useState,useRef} from "react";
import {useRouter} from "next/navigation";
type Shift={id:string;opened_at:string;closed_at:string|null;opening_cash:number|null;actual_cash:number|null;updated_at:string};
const local=(s:string|null)=>s?new Date(Date.parse(s)+7*3600000).toISOString().slice(0,19):"";
const thai=(s:string)=>s.length===16?s+":00+07:00":s+"+07:00";
export function RecyclingShiftHistoryActions({shift}:{shift:Shift}){
 const router=useRouter();
 const [mode,setMode]=useState<"edit"|"delete"|null>(null),[reason,setReason]=useState(""),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 const [opened,setOpened]=useState(local(shift.opened_at)),[closed,setClosed]=useState(local(shift.closed_at)),[opening,setOpening]=useState(shift.opening_cash===null?"":Number(shift.opening_cash).toFixed(2)),[actual,setActual]=useState(shift.actual_cash===null?"":Number(shift.actual_cash).toFixed(2));
 const locked=useRef(false);
 function show(action:"edit"|"delete"){setReason("");setConfirmed(false);setError("");setOpened(local(shift.opened_at));setClosed(local(shift.closed_at));setOpening(shift.opening_cash===null?"":Number(shift.opening_cash).toFixed(2));setActual(shift.actual_cash===null?"":Number(shift.actual_cash).toFixed(2));setMode(action);}
 async function save(){
  if(locked.current||!mode||!confirmed||reason.trim().length<5)return;
  locked.current=true;setBusy(true);setError("");
  try{
   const response=await fetch("/api/pos/recycling/shifts/"+encodeURIComponent(shift.id)+"/manage",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:mode,version:shift.updated_at,reason,confirmed,opened_at:opened===local(shift.opened_at)?shift.opened_at:thai(opened),closed_at:closed===local(shift.closed_at)?shift.closed_at:thai(closed),opening_cash:opening,actual_cash:actual})});
   const body=await response.json().catch(()=>null);
   if(!response.ok||!body?.data)throw Error(body?.error?.message??"ยังไม่ยืนยันผล กรุณารีเฟรช");
   setMode(null);router.refresh();
  }catch(e){setError(e instanceof Error?e.message:"ยังไม่ยืนยันผล");}finally{locked.current=false;setBusy(false);}
 }
 return <>
 <div className="flex gap-1 whitespace-nowrap"><button type="button" onClick={()=>show("edit")} className="rounded border border-blue-300 px-2 py-2 text-xs font-bold text-blue-700">แก้ไข</button><button type="button" onClick={()=>show("delete")} className="rounded border border-rose-200 px-2 py-2 text-xs font-bold text-rose-700">ลบ</button></div>
 {mode&&<div className="fixed inset-0 z-[1500] flex items-center justify-center bg-slate-950/60 p-3"><section role="dialog" aria-modal="true" aria-label={mode==="edit"?"แก้ไขกะ":"ลบกะทดสอบ"} className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5 shadow-xl">
 <h2 className="text-lg font-extrabold">{mode==="edit"?"แก้ไขประวัติกะ":"ลบกะทดสอบ"}</h2>
 <p className="my-3 text-sm text-slate-600">{mode==="edit"?"แก้ไขเฉพาะกะปิดล่าสุดที่ไม่กระทบกะถัดไป กะที่มีธุรกรรมแก้ไขได้เฉพาะยอดตรวจนับจริง ระบบคำนวณยอดตามบิลเอง":"ลบได้เฉพาะกะปิดล่าสุดที่ไม่มีธุรกรรมหรือข้อมูลเชื่อมโยง โดยเก็บประวัติการลบ"}</p>
 <form className="grid gap-3 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();void save();}}>
 {mode==="edit"&&<>
 <label className="grid gap-1 text-xs font-bold">วันที่–เวลาเปิดกะ (ไทย)<input required type="datetime-local" step="1" value={opened} onChange={e=>setOpened(e.target.value)} className="rounded border p-2 text-sm"/></label>
 <label className="grid gap-1 text-xs font-bold">วันที่–เวลาปิดกะ (ไทย)<input required type="datetime-local" step="1" value={closed} onChange={e=>setClosed(e.target.value)} className="rounded border p-2 text-sm"/></label>
 <label className="grid gap-1 text-xs font-bold">ทุนเงินสดเปิดกะ (บาท)<input required inputMode="decimal" pattern="[0-9]{1,12}(\\.[0-9]{1,2})?" value={opening} onChange={e=>setOpening(e.target.value)} className="rounded border p-2 text-sm"/></label>
 <label className="grid gap-1 text-xs font-bold">เงินสดนับจริง (บาท)<input required inputMode="decimal" pattern="[0-9]{1,12}(\\.[0-9]{1,2})?" value={actual} onChange={e=>setActual(e.target.value)} className="rounded border p-2 text-sm"/></label></>}
 <label className="grid gap-1 text-xs font-bold sm:col-span-2">เหตุผล<textarea required minLength={5} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} className="rounded border p-2 text-sm"/></label>
 <label className="flex gap-2 text-sm sm:col-span-2"><input required type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>{mode==="edit"?"ยืนยันวันที่และยอดเงินจริงที่ตรวจสอบแล้ว":"ยืนยันว่าเป็นกะทดสอบและไม่ใช่ธุรกรรมจริง"}</label>
 {error&&<p role="alert" className="rounded bg-rose-50 p-3 text-sm text-rose-800 sm:col-span-2">{error}</p>}
 <button type="button" disabled={busy} onClick={()=>setMode(null)} className="rounded border p-2 font-bold">ยกเลิก</button><button disabled={busy||!confirmed||reason.trim().length<5} type="submit" className={"rounded p-2 font-bold text-white disabled:opacity-50 "+(mode==="delete"?"bg-rose-700":"bg-blue-700")}>{busy?"กำลังบันทึก…":mode==="edit"?"บันทึกแก้ไข":"ยืนยันลบ"}</button>
 </form></section></div>}</>;
}
