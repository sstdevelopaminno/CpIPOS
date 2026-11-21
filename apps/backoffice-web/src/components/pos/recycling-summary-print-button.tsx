"use client";
import {useState} from "react";
import type {RecyclingReportQuery} from "@/lib/server/recycling-history-reports";
export function RecyclingSummaryPrintButton({filters}:{filters:RecyclingReportQuery}){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[error,setError]=useState("");
 async function run(){
  if(busy)return;setBusy(true);setNotice("");setError("");
  try{
   const response=await fetch("/api/pos/recycling/reports/print",{
    method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({request_id:crypto.randomUUID(),filters})
   });
   const data=await response.json().catch(()=>null) as {
    data?:{queued?:boolean;jobs?:Array<{id:string;status:string}>};
    error?:{message?:string};
   }|null;
   if(!response.ok||!data?.data?.queued||!data.data.jobs?.length){
    setError(data?.error?.message??"ไม่สามารถส่งรายงานไปยังเครื่องพิมพ์ได้");return;
   }
   const jobs=data.data.jobs;
   if(jobs.some(j=>j.status==="failed")){setError("งานพิมพ์ไม่สำเร็จ กรุณาตรวจเครื่องและคิว Print Agent");return;}
   setNotice(jobs.every(j=>j.status==="printed")
    ?"เครื่องพิมพ์ยืนยันการพิมพ์แล้ว"
    :"ส่งรายงานเข้าคิว Print Agent แล้ว กรุณาตรวจการพิมพ์ที่เครื่อง");
  }catch{setError("ไม่สามารถเชื่อมต่อ Print Agent หรือเซิร์ฟเวอร์");}
  finally{setBusy(false);}
 }
 return <div className="flex flex-col gap-1 print:hidden">
  <button type="button" disabled={busy} onClick={()=>void run()}
    className="min-h-10 rounded-lg border border-blue-300 bg-white px-3 text-sm font-semibold text-blue-700 disabled:opacity-60">
    {busy?"กำลังส่งพิมพ์...":"พิมพ์สรุปยอดขาย (58/80 มม.)"}
  </button>
  {notice&&<p role="status" className="max-w-xs text-xs text-green-800">{notice}</p>}
  {error&&<p role="alert" className="max-w-xs text-xs text-red-800">{error}</p>}
 </div>;
}
