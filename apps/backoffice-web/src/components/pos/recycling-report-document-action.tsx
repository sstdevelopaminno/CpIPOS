"use client";

import { useState } from "react";
import { RecyclingReceiptDialog } from "@/components/pos/recycling-receipt-dialog";

/** Only a committed, branch-authorized Recycling document can be previewed.
 * The nested dialog is strictly read-only until the cashier explicitly
 * submits a print request. No navigation and no new transaction.
 */
export function RecyclingReportDocumentAction({
 transactionId,receiptNo,label="ดู / พิมพ์"
}:{
 transactionId:string;receiptNo:string;label?:string;
}){
 const [open,setOpen]=useState(false);
 return <>
  <button type="button" onClick={()=>setOpen(true)}
   data-testid="recycling-report-receipt-popup-trigger"
   className="inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-md border border-blue-300 bg-white px-3 text-xs font-bold text-blue-700 hover:bg-blue-50">
   {label}
  </button>
  <RecyclingReceiptDialog open={open} onClose={()=>setOpen(false)}
   transactionId={transactionId} receiptNo={receiptNo}/>
 </>;
}
