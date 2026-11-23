import "server-only";
import type { AuthContext } from "@/lib/auth-context";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { resolvePrinterRoutes } from "@/lib/printing/printer-routing-service";
import { enqueuePrintJob } from "@/lib/printing/print-service";

const esc=(value:unknown)=>String(value??"")
 .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
 .replace(/"/g,"&quot;");

type ShiftRecord={
 id:string;status:string;opened_at:string;opening_cash:number|null;
 device_code:string|null;metadata:Record<string,unknown>|null
};

/** Read-only source of truth: print only a confirmed, open Recycling shift.
 * A shift-opening slip is NOT a receipt or a VAT/tax invoice. */
export async function queueRoutedRecyclingShiftOpenSlip(args:{
 auth:AuthContext;shiftId:string;runtimeDeviceCode:string|null
}){
 const tenantId=args.auth.tenantId,branchId=args.auth.branchId;
 const code=args.runtimeDeviceCode?.trim();
 if(!tenantId||!branchId||!code)throw new Error("recycling_shift_open_device_scope_required");
 const db=getSupabaseServiceClient();
 const shift=await db.from("shifts")
  .select("id,status,opened_at,opening_cash,device_code,metadata")
  .eq("id",args.shiftId).eq("tenant_id",tenantId).eq("branch_id",branchId)
  .eq("device_code",code).maybeSingle<ShiftRecord>();
 if(shift.error||!shift.data||shift.data.status!=="open"||
    shift.data.metadata?.business_shift_mode!=="recycling_daily"){
  throw new Error("recycling_shift_open_print_not_authorized");
 }
 const routes=await resolvePrinterRoutes({
  auth:args.auth,purpose:"shift_report",fallbackPurposes:["receipt"],
  runtimeDeviceCode:code,legacyRole:"report"
 });
 // Opt in the exact Windows test printer only; other Windows tenants and
 // Android printers retain their existing opening-shift behavior.
 const eligible=routes.filter(route=>{
  const m=route.printer.metadata&&typeof route.printer.metadata==="object"&&!Array.isArray(route.printer.metadata)
   ?route.printer.metadata as Record<string,unknown>:{};
  return (route.printer.printer_role==="receipt"||route.printer.printer_role==="report") &&
   m.target_runtime==="windows_native"&&m.windows_device_code===code &&
   m.windows_shift_open_auto_print===true;
 });
 if(!eligible.length)return [];
 const route=eligible[0];
 const paper=route.printer.paper_width_mm===80?80:58;
 const m=route.printer.metadata&&typeof route.printer.metadata==="object"&&!Array.isArray(route.printer.metadata)
  ?route.printer.metadata as Record<string,unknown>:{};
 const requestedWidth=Number(m.windows_receipt_printable_mm);
 const width=paper===80&&m.windows_receipt_centered===true&&Number.isFinite(requestedWidth)&&
  requestedWidth>=56&&requestedWidth<=70?requestedWidth:paper===80?56:45;
 const rawOffset=Number(m.windows_receipt_offset_mm);
 const offset=Number.isFinite(rawOffset)?Math.max(-6,Math.min(6,rawOffset)):0;
 const left=paper===80&&m.windows_receipt_centered===true?
  Math.max(0,(paper-width)/2+offset):1;
 const branch=await db.from("branches").select("name").eq("id",branchId)
  .eq("tenant_id",tenantId).maybeSingle<{name:string|null}>();
 if(branch.error)throw new Error("recycling_shift_open_branch_unavailable");
 const opened=new Intl.DateTimeFormat("th-TH",{
  dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Bangkok"
 }).format(new Date(shift.data.opened_at));
 const openingCash=Number(shift.data.opening_cash??0);
 if(!Number.isFinite(openingCash)||openingCash<0)throw new Error("recycling_shift_open_cash_invalid");
 const cash=openingCash.toLocaleString("th-TH",{minimumFractionDigits:2,maximumFractionDigits:2});
 const branchName=branch.data?.name??"สาขาหลัก";
 const html='<!doctype html><html lang="th"><head><meta charset="utf-8"/>'+
  '<style>@page{size:'+paper+'mm auto;margin:0}*{box-sizing:border-box}'+
  'html,body{margin:0;padding:0;width:'+paper+'mm;background:#fff;color:#000;'+
  'font:12px/1.35 Tahoma,"Noto Sans Thai",sans-serif}'+
  'main{width:'+width+'mm;margin:0 0 0 '+left+'mm;padding:2mm 0}'+
  'h1{font-size:17px;text-align:center;margin:3mm 0 2mm}'+
  '.r{display:flex;justify-content:space-between;gap:2mm;margin:2mm 0}'+
  '.r>span{min-width:0;overflow-wrap:anywhere}.r strong{white-space:nowrap}'+
  'hr{border:0;border-top:1px dashed #000;margin:2mm 0}'+
  '.note{text-align:center;font-size:10px;margin:3mm 0}</style></head>'+
  '<body><main><h1>ใบยืนยันเปิดกะ · CUSTOM Recycling</h1>'+
  '<p>สาขา: '+esc(branchName)+'</p>'+
  '<p>เครื่อง POS: '+esc(code)+'</p>'+
  '<p>เวลาเปิดกะ: '+esc(opened)+'</p>'+
  '<p>รหัสกะ: '+esc(shift.data.id.slice(0,12))+'</p><hr/>'+
  '<div class="r"><span>เงินสดต้นกะที่ยืนยัน</span><strong>'+esc(cash)+' บาท</strong></div>'+
  '<hr/><p class="note">เอกสารยืนยันเปิดกะ ไม่ใช่ใบเสร็จรับเงินหรือใบกำกับภาษี</p>'+
  '</main></body></html>';
 const idempotencyKey="recycling-shift-open:"+shift.data.id+":"+code+":auto-first-v1";
 const existing=await db.from("print_jobs").select("id,status,printed_at,last_error")
  .eq("tenant_id",tenantId).eq("branch_id",branchId)
  .eq("idempotency_key",idempotencyKey).maybeSingle();
 if(existing.error)throw new Error("recycling_shift_open_print_lookup_failed");
 if(existing.data)return [{...existing.data,fast_wake:false}];
 let job;
 try{
  job=await enqueuePrintJob({
   auth:args.auth,printer:route.printer,orderId:null,
   printerRole:route.printer.printer_role,
   idempotencyKey,
   payloadText:"เปิดกะ CUSTOM Recycling\n"+branchName+"\n"+opened+
    "\nเงินสดต้นกะ "+cash+" บาท\nไม่ใช่ใบเสร็จหรือใบกำกับภาษี",
   payloadJson:{shift_id:shift.data.id,document_type:"recycling_shift_open_slip"},
   metadata:{
    request_source:"recycling_shift_open",
    routing_purpose:route.purpose,
    routing_printer_device_id:route.printerDeviceId,
    paper_width_mm:paper,payload_format:"shift_report_html_v1",
    payload_html:html,copy_number:1,copy_count:1,
    quarantine_replay_allowed:false
   }
  });
 }catch(error){
  const winner=await db.from("print_jobs").select("id,status,printed_at,last_error")
   .eq("tenant_id",tenantId).eq("branch_id",branchId)
   .eq("idempotency_key",idempotencyKey).maybeSingle();
  if(winner.data)return [{...winner.data,fast_wake:false}];
  throw error;
 }
 return [{id:job.id,status:job.status,printed_at:job.printed_at,
  last_error:job.last_error,fast_wake:m.windows_receipt_fast_wake===true}];
}
