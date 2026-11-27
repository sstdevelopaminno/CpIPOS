"use client";
import {useEffect,useState} from "react";
import {recyclingDocumentClockAt,type RecyclingDocumentClock} from "@/lib/recycling-document-time";
export function RecyclingDocumentClockStatus({clock,onReset,disabled}:{clock:RecyclingDocumentClock;onReset:()=>void;disabled:boolean}){
 const [display,setDisplay]=useState("");
 useEffect(()=>{
  const tick=()=>setDisplay(recyclingDocumentClockAt(clock,new Date()));
  tick();const timer=window.setInterval(tick,1000);
  return()=>window.clearInterval(timer);
 },[clock]);
 return <div role="status" className="mx-2 my-1 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
 <div><strong>โหมดบันทึกย้อนหลัง · {display.replace("T"," ")}</strong><span className="ml-2 text-xs">เดินเวลาต่อเนื่อง · ตรวจสอบวันเวลาที่เกิดรายการจริงก่อนยืนยันทุกบิล</span></div>
 <button type="button" disabled={disabled} onClick={onReset} className="rounded-lg border border-amber-400 bg-white px-3 py-2 text-xs font-bold disabled:opacity-50">คืนวันเวลาปัจจุบัน</button>
 </div>;
}
