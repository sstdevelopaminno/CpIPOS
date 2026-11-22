"use client";

import { useState } from "react";
import type { RecyclingTransaction } from "@/lib/server/recycling-history-reports";

type ExportRow=Pick<RecyclingTransaction,
  "receipt_no"|"created_at"|"direction"|"counterparty_name"|"settlement"|"total_minor"|"status"> & {
    branch_name:string;
  };

function quoteCell(raw:string|number):string{
  const value=String(raw);
  // Prevent spreadsheet formula execution in exports that contain an entered
  // supplier/customer name or an externally generated document identifier.
  const safe=/^[\s\u0000-\u001f]*[=+\-@]/.test(value)?"'"+value:value;
  return '"'+safe.replace(/"/g,'""')+'"';
}

export function RecyclingSalesListExport({rows,from,to}:{rows:ExportRow[];from:string;to:string}){
  const [exporting,setExporting]=useState(false);
  function exportCsv(){
    if(exporting||!rows.length)return;
    setExporting(true);
    try{
      const header=["วันเวลา (Asia/Bangkok)","เลขเอกสาร","ประเภท","ผู้ขาย/ผู้ซื้อ","สาขา",
        "วิธีชำระ","ยอดเงิน (บาท)","สถานะ"];
      const data=rows.map(row=>[
        new Date(row.created_at).toLocaleString("sv-SE",{timeZone:"Asia/Bangkok"}),
        row.receipt_no,row.direction==="buy"?"รับซื้อเข้าร้าน":"ขายออก",
        row.counterparty_name||"-",row.branch_name,
        row.settlement==="cash"?"เงินสด":row.settlement==="credit"?"เครดิต":"ระบุโอนเงิน (ยังไม่ยืนยัน)",
        (row.total_minor/100).toFixed(2),row.status==="voided"?"ยกเลิก (VOID)":"บันทึกแล้ว"
      ]);
      const csv="\uFEFF"+[header,...data].map(line=>line.map(quoteCell).join(",")).join("\r\n");
      const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
      const anchor=document.createElement("a");
      anchor.href=url;
      anchor.download="cpipos-recycling-buy-sell-"+from+"-"+to+".csv";
      document.body.appendChild(anchor);
      anchor.click();anchor.remove();
      window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    }finally{setExporting(false);}
  }
  return <button type="button" onClick={exportCsv} disabled={!rows.length||exporting}
    title="ส่งออกรายการตามตัวกรองปัจจุบัน ไม่รวมข้อมูล POS ทั่วไป"
    className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
    {exporting?"กำลังส่งออก…":"Export CSV"}
  </button>;
}
