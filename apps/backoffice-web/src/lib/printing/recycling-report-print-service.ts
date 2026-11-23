import "server-only";
import type { AuthContext } from "@/lib/auth-context";
import type { RecyclingHistoryReport } from "@/lib/server/recycling-history-reports";
import { readEnv } from "@/lib/env";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { resolvePrinterRoutes } from "@/lib/printing/printer-routing-service";
import { enqueuePrintJob, processPrintJob } from "@/lib/printing/print-service";
const minor=(amount:number)=>new Intl.NumberFormat("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2}).format(amount/100);
const escape=(value:string)=>value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
export function renderRecyclingSummaryReportHtml(report:RecyclingHistoryReport,paper:58|80,centerOnPaper=false,thermalOffsetMm=0):string{
 const rows:[string,string][]=[
  ["ขายออก",minor(report.totals.sellMinor)],["รับซื้อเข้าร้าน",minor(report.totals.buyMinor)],
  ["จำนวนบิลขายออก",String(report.totals.sellCount)],["จำนวนใบรับซื้อ",String(report.totals.buyCount)],
  ["เงินสดรับจากขายออก",minor(report.totals.cashInMinor)],["เงินสดจ่ายรับซื้อ",minor(report.totals.cashOutMinor)],
  ["เงินโอนเข้าตามรายการ",minor(report.totals.transferInMinor)],["เงินโอนออกตามรายการ",minor(report.totals.transferOutMinor)],
  ["เครดิตขายออก",minor(report.totals.creditInMinor)],["เครดิตรับซื้อ",minor(report.totals.creditOutMinor)],
  ["เอกสาร VOID",String(report.totals.voidCount)]
 ];
 const body=rows.map(([k,v])=>'<div class="r"><span>'+escape(k)+'</span><strong>'+escape(v)+'</strong></div>').join("");
 const width=paper===80?56:42;
 const calibration=Number.isFinite(thermalOffsetMm)?Math.max(-6,Math.min(6,thermalOffsetMm)):0;
 const leftMargin=centerOnPaper?Math.max(0,(paper-width)/2+calibration):(paper===80?2:1);
 return '<!doctype html><html lang="th"><head><meta charset="utf-8"/>'
  +'<title>สรุปรับซื้อ–ขายออก Recycling</title><style>@page{size:'+paper+'mm auto;margin:0}'
  +'*{box-sizing:border-box}html,body{margin:0;padding:0;width:'+paper+'mm;color:#000;background:#fff;font:11px/1.35 Tahoma,"Noto Sans Thai",sans-serif}'
  +'main{width:'+width+'mm;margin-left:'+leftMargin+'mm;padding:2mm 0}.r{display:flex;justify-content:space-between;gap:4px;margin:3px 0}'
  +'.r span{flex:1;min-width:0;overflow-wrap:anywhere}.r strong{text-align:right;white-space:nowrap}'
  +'h1{font-size:14px;text-align:center;margin:3px 0 6px}hr{border:0;border-top:1px dashed #000;margin:8px 0}'
  +'p{margin:5px 0;font-size:10px;overflow-wrap:anywhere}</style></head><body><main>'
  +'<h1>รายงานรับซื้อ / ขายออก</h1><p>CUSTOM Recycling · รายงานข้อมูล ไม่ใช่ใบเสร็จหรือใบกำกับภาษี</p>'
  +'<p>ช่วง: '+escape(report.from)+' ถึง '+escape(report.to)+'</p>'
  +'<p>สาขา: '+escape(report.branch==="all"?"ทุกสาขาที่ได้รับสิทธิ์":report.branchOptions.find(b=>b.id===report.branch)?.name??"สาขา")+'</p>'
  +'<hr/>'+body+'<hr/><p>ยอดขายออกและยอดรับซื้อแยกกัน · ไม่นำรับซื้อเป็นยอดขายติดลบ</p>'
  +'<p>รายการโอนยังไม่ใช่หลักฐานยืนยันการโอนเงินจากธนาคาร</p></main></body></html>';
}
export async function queueRoutedRecyclingReport(args:{
 auth:AuthContext;deviceCode:string|null;report:RecyclingHistoryReport;requestId:string;
}){
 if(!args.auth.tenantId||!args.auth.branchId||!args.deviceCode)throw new Error("recycling_report_device_scope_required");
 let routes=await resolvePrinterRoutes({
  auth:args.auth,purpose:"shift_report",fallbackPurposes:["receipt"],
  runtimeDeviceCode:args.deviceCode,legacyRole:"report"
 });
 if(!routes.length)routes=await resolvePrinterRoutes({
  auth:args.auth,purpose:"receipt",runtimeDeviceCode:args.deviceCode,legacyRole:"receipt"
 });
 if(!routes.length)throw new Error("recycling_report_printer_not_configured");
 // Only a single destination/copy per explicit click; the printer agent owns physical output.
 const route={...routes[0],copies:1};
 const paper=route.printer.paper_width_mm===80?80:58;
 const meta=route.printer.metadata&&typeof route.printer.metadata==="object"&&!Array.isArray(route.printer.metadata)
   ?route.printer.metadata as Record<string,unknown>:{};
 const windowsLab=meta.target_runtime==="windows_native"&&meta.windows_device_code===args.deviceCode;
 const fastWake=windowsLab&&meta.windows_receipt_fast_wake===true;
 const centerOnPaper=windowsLab&&meta.windows_receipt_centered===true;
 const rawOffset=Number(meta.windows_receipt_offset_mm);
 const html=renderRecyclingSummaryReportHtml(args.report,paper,
  centerOnPaper,centerOnPaper&&Number.isFinite(rawOffset)?rawOffset:0);
 const key="recycling-summary:"+args.requestId+":"+route.printer.id;
 const db=getSupabaseServiceClient();
 const existing=await db.from("print_jobs").select("id,status,printer_id,printed_at,last_error")
   .eq("tenant_id",args.auth.tenantId).eq("branch_id",args.auth.branchId)
   .eq("idempotency_key",key).maybeSingle();
 if(existing.error)throw new Error("recycling_report_print_dedup_failed");
 if(existing.data)return [{...existing.data,fast_wake:fastWake}];
 let job;
 try{
  job=await enqueuePrintJob({
   // Jobs must carry the destination profile's role: claim_print_jobs_v2
   // intentionally refuses mismatches (report jobs on receipt printers).
   auth:args.auth,printer:route.printer,orderId:null,printerRole:route.printer.printer_role,idempotencyKey:key,
   payloadText:"สรุปรับซื้อ–ขายออก "+args.report.from+" ถึง "+args.report.to,
   payloadJson:{document_type:"recycling_sales_summary",period_from:args.report.from,period_to:args.report.to,
    buy_minor:args.report.totals.buyMinor,sell_minor:args.report.totals.sellMinor},
   metadata:{request_source:"recycling_report_manual",routing_source:route.source,
    routing_purpose:route.purpose,routing_printer_device_id:route.printerDeviceId,
    copy_number:1,copy_count:1,paper_width_mm:paper,payload_format:"receipt_html_v1",payload_html:html}
  });
 }catch(error){
  // Concurrent retries with the same request UUID must not produce extra jobs.
  const check=await db.from("print_jobs").select("id,status,printer_id,printed_at,last_error")
   .eq("tenant_id",args.auth.tenantId).eq("branch_id",args.auth.branchId)
   .eq("idempotency_key",key).maybeSingle();
  if(check.data) return [{...check.data,fast_wake:fastWake}];
  throw error;
 }
 const direct=(route.printer.metadata&&typeof route.printer.metadata==="object"&&!Array.isArray(route.printer.metadata))
  ?route.printer.metadata as Record<string,unknown>:{};
 const queued=readEnv("VERCEL")==="1"||Boolean(readEnv("VERCEL_ENV"))||
  direct.print_mode==="agent"||direct.queue_only===true;
 const result=queued?job:(await processPrintJob(job.id))??job;
 return [{id:result.id,status:result.status,printer_id:result.printer_id,
  printed_at:result.printed_at,last_error:result.last_error,fast_wake:fastWake}];
}
