"use client";
import { useEffect, useRef, useState } from "react";
import type { RecyclingCatalogItem } from "@/lib/server/recycling-pos-service";
import { opticalCode128Svg } from "@/lib/optical/optical-code128-barcode";
import { recyclingBarcodePrintDimensions, type RecyclingBarcodeLabelSize } from "@/lib/recycling-barcode-print-layout";

export function recyclingBarcodeMarkup(sku:string):string|null{
 try{return opticalCode128Svg(sku)}catch{return null}
}
/** SVG is exclusively generated from the immutable Code128 pattern table, never raw SKU markup. */
export function RecyclingBarcodeMark({sku,compact=false,previewWidthMm}:{sku:string;compact?:boolean;previewWidthMm?:number}){
 const markup=recyclingBarcodeMarkup(sku);
 if(!markup)return <span className="text-[11px] text-amber-700">รหัสนี้ไม่รองรับบาร์โค้ด</span>;
 return <span aria-hidden="true" className={compact
   ?"block w-28 [&_svg]:h-8 [&_svg]:w-full"
   :"block w-full max-w-[440px] [&_svg]:h-auto [&_svg]:w-full"}
   style={!compact && previewWidthMm ? {width:previewWidthMm+"mm",maxWidth:"100%"}:undefined}
   dangerouslySetInnerHTML={{__html:markup}}/>;
}
export function RecyclingBarcodeDialog({item,branchId,branchName,onClose}:{
 item:RecyclingCatalogItem;branchId:string;branchName:string;onClose:()=>void
}){
 const [busy,setBusy]=useState(false),[notice,setNotice]=useState(""),[error,setError]=useState("");
 const [labelSize,setLabelSize]=useState<RecyclingBarcodeLabelSize>("large");
 const [pendingJobId,setPendingJobId]=useState<string|null>(null);
 const [statusRevision,setStatusRevision]=useState(0);
 const [statusTimedOut,setStatusTimedOut]=useState(false);
 const submittingRef=useRef(false);
 // Reuse this identifier after an ambiguous HTTP response. A second click
 // must never generate a different physical print for the same request.
 const requestIdRef=useRef<string|null>(null);
 useEffect(()=>{
  if(!pendingJobId)return;
  let stopped=false,attempts=0;
  let timer:ReturnType<typeof setTimeout>|null=null;
  const abort=new AbortController();
  setStatusTimedOut(false);
  async function readStatus(){
   if(stopped)return;
   attempts+=1;
   try{
    const response=await fetch("/api/pos/recycling/barcodes/print?job_id="+encodeURIComponent(pendingJobId!),{
     credentials:"same-origin",cache:"no-store",signal:abort.signal
    });
    const body=await response.json().catch(()=>null) as {
     data?:{job?:{status?:string};agent_online?:boolean|null};
     error?:{message?:string}
    }|null;
    if(!response.ok||!body?.data?.job)throw new Error("print_status_unavailable");
    if(stopped)return;
    const status=body.data.job.status;
    if(status==="printed"){
     setPendingJobId(null);requestIdRef.current=null;
     setNotice("Windows รับงานเข้าคิวเครื่องพิมพ์แล้ว กรุณาตรวจกระดาษจริง");
     setError("");return;
    }
    if(status==="failed"){
     setPendingJobId(null);
     setError("งานพิมพ์ล้มเหลวหรือผลไม่แน่นอน กรุณาตรวจเครื่องและคิว Windows ก่อนสั่งพิมพ์ใหม่");
     return;
    }
    setNotice(body.data.agent_online===false
     ?"บันทึกคิวแล้ว แต่ Windows Print Agent ไม่ตอบสนอง กรุณาเปิด CpiPOS Windows Web POS ที่เครื่องพิมพ์"
     :status==="printing"
      ?"Print Agent รับงานแล้ว กำลังส่งเข้าเครื่องพิมพ์ ห้ามกดซ้ำ"
      :"รับคำสั่งแล้ว กำลังรอ Print Agent ดึงงาน ห้ามกดพิมพ์ซ้ำ");
   }catch{
    if(stopped)return;
    setNotice("รับคิวพิมพ์แล้ว แต่ตรวจสอบสถานะล่าสุดไม่ได้ กรุณาตรวจเครื่องพิมพ์ก่อนสั่งซ้ำ");
   }
   if(attempts>=12){
    if(!stopped)setStatusTimedOut(true);
   }else if(!stopped){
    timer=setTimeout(()=>void readStatus(),2800);
   }
  }
  timer=setTimeout(()=>void readStatus(),900);
  return ()=>{
   stopped=true;abort.abort();
   if(timer)clearTimeout(timer);
  };
 },[pendingJobId,statusRevision]);
 let previewWidthMm:number|null=null;
 try{previewWidthMm=recyclingBarcodePrintDimensions(item.sku,80,labelSize).widthMm;}
 catch{previewWidthMm=null;}
 const valid=Boolean(recyclingBarcodeMarkup(item.sku)) && previewWidthMm!==null;
 async function print(){
  if(!valid||busy||pendingJobId||submittingRef.current)return;
  submittingRef.current=true;
  setBusy(true);setError("");setNotice("กำลังส่งคำสั่งพิมพ์เข้าคิว...");
  // Preserve the request ID on uncertain HTTP outcomes. Retrying this same
  // request is idempotent; it cannot create a second spool job.
  requestIdRef.current??=crypto.randomUUID();
  window.dispatchEvent(new Event("cpi-windows-fast-print-prime"));
  try{
   const response=await fetch("/api/pos/recycling/barcodes/print",{
    method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({request_id:requestIdRef.current,product_id:item.id,branch_id:branchId,size:labelSize})
   });
   const body=await response.json().catch(()=>null) as {
    data?:{jobs?:Array<{id?:string;status?:string;fast_wake?:boolean}>};
    error?:{message?:string}
   }|null;
   if(!response.ok||!body?.data?.jobs?.length){
    setError(body?.error?.message||"ยังไม่ยืนยันผลคำสั่งพิมพ์ ตรวจคิวก่อนกดซ้ำ (ระบบจะใช้คำขอเดิม)");
    return;
   }
   const jobs=body.data.jobs;
   if(jobs.some(job=>job.status==="failed")){
    setError("คิวพิมพ์ล้มเหลว กรุณาตรวจ Print Agent และกระดาษก่อนสั่งใหม่");
    return;
   }
   if(jobs.every(job=>job.status==="printed")){
    requestIdRef.current=null;
    setNotice("Windows รับงานเข้าคิวเครื่องพิมพ์แล้ว กรุณาตรวจกระดาษจริง");
    return;
   }
   const tracking=jobs.find(job=>job.id && ["pending","retrying","printing"].includes(job.status??""));
   if(!tracking?.id){
    setError("ยังไม่ยืนยันสถานะงานพิมพ์ กรุณาตรวจคิว Windows ก่อนส่งซ้ำ");
    return;
   }
   setPendingJobId(tracking.id);
   setNotice("รับคำสั่งแล้ว กำลังตรวจสอบ Print Agent ห้ามกดพิมพ์ซ้ำ");
   // Explicit physical-print intent wakes the local native agent regardless of
   // polling enrollment; a normal browser without a bridge ignores the event.
   window.dispatchEvent(new Event("cpi-windows-print-agent-wake"));
  }catch{
   setError("ไม่ทราบว่าเซิร์ฟเวอร์รับงานหรือไม่ ตรวจคิวก่อนกดอีกครั้ง (ใช้รหัสคำขอเดิม ไม่สร้างงานซ้ำ)");
  }finally{
   submittingRef.current=false;setBusy(false);
  }
 }
 return <div className="fixed inset-0 z-[1210] flex items-center justify-center bg-slate-950/70 p-3"
   role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose()}}>
   <section role="dialog" aria-modal="true" aria-label={"บาร์โค้ด "+item.name}
     className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-2xl">
    <header className="flex items-start justify-between gap-3">
     <div><p className="text-xs font-bold text-blue-700">CUSTOM Recycling · {branchName}</p>
      <h2 className="mt-1 text-lg font-extrabold text-slate-900">บาร์โค้ดวัสดุ · {item.name}</h2></div>
     <button type="button" disabled={busy} onClick={onClose} aria-label="ปิดหน้าต่างบาร์โค้ด"
       className="h-9 w-9 rounded-lg border border-slate-300 text-lg">×</button>
    </header>
    <div className="mt-4 flex flex-col items-center rounded-lg border border-slate-200 bg-white p-5">
     <RecyclingBarcodeMark sku={item.sku} previewWidthMm={previewWidthMm??undefined}/>
     <strong className="mt-2 break-all font-mono text-base tracking-wide">{item.sku}</strong>
     <p className="mt-1 text-xs text-slate-500">Code 128 · ใช้รหัสเดียวทั้งรับซื้อและขายออก</p>
    </div>
    <label htmlFor="recycling-barcode-label-size" className="mt-3 block text-sm font-semibold text-slate-700">ขนาดบาร์โค้ดบนกระดาษจริง</label>
    <select id="recycling-barcode-label-size" value={labelSize} disabled={busy||Boolean(pendingJobId)}
      onChange={event=>setLabelSize(event.target.value as RecyclingBarcodeLabelSize)}
      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
      <option value="small">เล็ก (เท่าขนาดเดิม)</option>
      <option value="medium">กลาง</option>
      <option value="large">ใหญ่ (แนะนำ)</option>
      <option value="full">เต็มพื้นที่พิมพ์ 58/80 มม.</option>
    </select>
    <p className="mt-1 text-xs text-slate-600">ปรับความกว้างของแท่งบาร์โค้ดจริง ไม่ใช่ขยายแค่รูปพรีวิว และจำกัดความกว้างเพื่อป้องกันการตัดขอบ</p>
    {!valid&&<p role="alert" className="mt-3 text-sm text-amber-800">รหัสต้องเป็น ASCII ที่พิมพ์ได้ ไม่เกิน 60 ตัวอักษร จึงแสดงบาร์โค้ด Code 128 ได้</p>}
    <p className="mt-3 text-xs text-slate-600">พิมพ์ฉลากผ่านเครื่องใบเสร็จ 58/80 มม. ที่ผูกกับเครื่อง POS สาขานี้ · ไม่บันทึกบิลและไม่เปลี่ยนสต๊อก</p>
    {notice&&<p role="status" className="mt-3 text-sm text-emerald-800">{notice}</p>}
    {error&&<p role="alert" className="mt-3 text-sm text-rose-800">{error}</p>}
    {pendingJobId&&statusTimedOut&&
     <button type="button" onClick={()=>setStatusRevision(v=>v+1)}
      className="mt-2 rounded-lg border border-blue-300 px-3 py-2 text-xs font-bold text-blue-800">
      ตรวจสอบคิวงานเดิมอีกครั้ง (ไม่สั่งพิมพ์ซ้ำ)
     </button>}
    <footer className="mt-5 flex justify-end gap-2">
     <button type="button" disabled={busy} onClick={onClose} className="min-h-10 rounded-lg border border-slate-300 px-4 font-bold text-slate-700">ปิด</button>
     <button type="button" disabled={busy||!valid||Boolean(pendingJobId)} onClick={()=>void print()}
       className="min-h-10 rounded-lg bg-blue-700 px-5 font-bold text-white disabled:opacity-50">{busy?"กำลังส่งพิมพ์...":pendingJobId?"รอยืนยันคิวพิมพ์...":"พิมพ์บาร์โค้ด 58/80 มม."}</button>
    </footer>
   </section>
  </div>;
}
