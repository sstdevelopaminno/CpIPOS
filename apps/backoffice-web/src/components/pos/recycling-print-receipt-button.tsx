"use client";

import { useState } from "react";

export function RecyclingPrintReceiptButton({ receiptId, showBrowserButton = true }: {
  receiptId:string;showBrowserButton?:boolean;
}) {
  const [pending,setPending]=useState(false);
  const [status,setStatus]=useState("");
  const [error,setError]=useState("");

  async function queuePrinter() {
    if (pending) return;
    setPending(true);
    setStatus("");
    setError("");
    try {
      const response=await fetch(`/api/pos/recycling/receipts/${receiptId}/print`,{
        method:"POST",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({request_id:crypto.randomUUID()})
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
      if (jobs.some(job=>job.fast_wake===true && job.status==="pending")) {
        window.dispatchEvent(new Event("cpi-windows-print-agent-wake"));
      }
      setStatus(jobs.every(job=>job.status==="printed")
        ? "เครื่องพิมพ์ยืนยันการพิมพ์แล้ว"
        : `ส่งคำขอไปยังคิวเครื่องพิมพ์ ${jobs.length} งานแล้ว กรุณาตรวจสถานะที่เครื่องหรือ Print Agent`);
    } catch {
      setError("เชื่อมต่อ Print Agent ไม่สำเร็จ ลองใช้ปุ่มพิมพ์ผ่านเบราว์เซอร์แทน");
    } finally {
      setPending(false);
    }
  }

  return <div className="space-y-2 print:hidden">
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={()=>void queuePrinter()} disabled={pending}
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
