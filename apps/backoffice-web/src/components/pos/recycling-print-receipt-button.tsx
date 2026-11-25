"use client";

import { useRef, useState } from "react";

export function RecyclingPrintReceiptButton({ receiptId, showBrowserButton = true, disabled = false, retryRequestId }: {
  receiptId:string;showBrowserButton?:boolean;disabled?:boolean;retryRequestId?:string;
}) {
  const inFlight=useRef(false);
  const retry=useRef<{receiptId:string;requestId:string}|null>(null);
  const consumedSeed=useRef<string|null>(null);
  const [pending,setPending]=useState(false);
  const [status,setStatus]=useState("");
  const [error,setError]=useState("");

  async function queuePrinter() {
    if (disabled || inFlight.current || pending) return;
    inFlight.current=true;
    setPending(true);
    setStatus("");
    setError("");
    try {
      const seed=retryRequestId && consumedSeed.current!==retryRequestId ? retryRequestId : undefined;
      const requestId=retry.current?.receiptId===receiptId ? retry.current.requestId : seed ?? crypto.randomUUID();
      if(seed) consumedSeed.current=seed;
      retry.current={receiptId,requestId};
      window.dispatchEvent(new Event("cpi-windows-fast-print-prime"));
      const response=await fetch(`/api/pos/recycling/receipts/${receiptId}/print`,{
        method:"POST",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({request_id:requestId})
      });
      const result=await response.json().catch(()=>null) as {
        data?: {queued?: boolean;jobs?: Array<{id:string;status:string;fast_wake?:boolean}>};
        error?: {code?: string;message?: string};
      }|null;
      if (!response.ok || !result?.data?.queued) {
        setError(result?.error?.message ?? "ส่งคำสั่งพิมพ์ไปยังเครื่อง POS ไม่สำเร็จ");
        return;
      }
      const jobs=result.data.jobs??[];
      if (!jobs.length || jobs.some(job=>job.status==="failed")) {
        setError("พบงานพิมพ์ไม่สำเร็จ กรุณาตรวจสอบคิวและเครื่องพิมพ์ก่อนลองใหม่");
        return;
      }
      retry.current=null; // Only a confirmed non-failed queue response permits a new intentional reprint.
      if (jobs.some(job=>job.fast_wake===true && job.status==="pending")) {
        window.dispatchEvent(new Event("cpi-windows-print-agent-wake"));
      }
      setStatus(jobs.every(job=>job.status==="printed")
        ? "เครื่องพิมพ์ยืนยันการพิมพ์แล้ว"
        : `ส่งคำขอไปยังคิวเครื่องพิมพ์ ${jobs.length} งานแล้ว กรุณาตรวจสถานะที่เครื่องหรือ Print Agent`);
    } catch {
      setError("ยังยืนยันคิวพิมพ์ไม่ได้ กรุณาตรวจเครื่องพิมพ์แล้วลองส่งคำขอเดิมอีกครั้ง");
    } finally {
      inFlight.current=false;
      setPending(false);
    }
  }

  return <div className="space-y-2 print:hidden">
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={()=>void queuePrinter()} disabled={disabled||pending}
        className="rounded-lg bg-blue-700 px-5 py-3 text-sm font-bold text-white hover:bg-blue-800 disabled:opacity-50">
        {pending ? "กำลังส่งคิว..." : "พิมพ์ผ่านเครื่อง POS (58/80 มม.)"}
      </button>
      {showBrowserButton&&<button type="button" onClick={()=>window.print()}
        className="rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 hover:bg-slate-100">
        พิมพ์ผ่านเบราว์เซอร์
      </button>}
    </div>
    {status && <p role="status" className="rounded-lg bg-emerald-50 p-2 text-xs font-semibold text-emerald-800">{status}</p>}
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-xs font-semibold text-rose-800">{error}</p>}
  </div>;
}
