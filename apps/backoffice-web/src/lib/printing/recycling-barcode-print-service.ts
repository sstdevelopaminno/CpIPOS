import "server-only";
import type { AuthContext } from "@/lib/auth-context";
import { resolvePrinterRoutes } from "@/lib/printing/printer-routing-service";
import { enqueuePrintJob, processPrintJob } from "@/lib/printing/print-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { readEnv } from "@/lib/env";
import { renderRecyclingBarcodeLabel, type RecyclingBarcodeLabelSize } from "@/lib/recycling-barcode-print-layout";

export async function queueRoutedRecyclingBarcode(args:{
 auth:AuthContext;runtimeDeviceCode:string|null;requestId:string;productId:string;
 sku:string;name:string;branchName:string;size:RecyclingBarcodeLabelSize;
}){
 if(!args.auth.tenantId||!args.auth.branchId||!args.runtimeDeviceCode)
  throw new Error("recycling_barcode_device_scope_required");
 const routes=await resolvePrinterRoutes({
  auth:args.auth,purpose:"receipt",fallbackPurposes:["reprint"],
  runtimeDeviceCode:args.runtimeDeviceCode,legacyRole:"receipt"
 });
 if(!routes.length)throw new Error("recycling_barcode_printer_not_configured");
 const route=routes[0],width=Number(route.printer.paper_width_mm);
 const meta=route.printer.metadata&&typeof route.printer.metadata==="object"&&!Array.isArray(route.printer.metadata)
  ?route.printer.metadata as Record<string,unknown>:{};
 const windowsLabPrinter=meta.target_runtime==="windows_native" &&
   meta.windows_device_code===args.runtimeDeviceCode;
 const fastWake=windowsLabPrinter && meta.windows_receipt_fast_wake===true;
 const centerOnPaper=windowsLabPrinter && meta.windows_receipt_centered===true;
 const rawOffset=Number(meta.windows_receipt_offset_mm);
 const thermalOffsetMm=centerOnPaper && Number.isFinite(rawOffset)?
   Math.max(-6,Math.min(6,rawOffset)):0;
 if(width!==58 && width!==80)throw new Error("recycling_barcode_paper_unsupported");
 const html=renderRecyclingBarcodeLabel({
  sku:args.sku,name:args.name,branchName:args.branchName,paper:width,
  size:args.size,centerOnPaper,thermalOffsetMm
 });
 const key="recycling-barcode:"+args.requestId+":"+args.productId+":"+route.printer.id;
 const db=getSupabaseServiceClient();
 const lookup=()=>db.from("print_jobs").select("id,status,printer_id,printed_at,last_error")
  .eq("tenant_id",args.auth.tenantId!).eq("branch_id",args.auth.branchId!)
  .eq("idempotency_key",key).maybeSingle();
 const old=await lookup();
 if(old.error)throw new Error("recycling_barcode_print_lookup_failed");
 if(old.data)return [{...old.data,fast_wake:fastWake}];
 let job;
 try{
  job=await enqueuePrintJob({
   auth:args.auth,printer:route.printer,orderId:null,printerRole:"receipt",
   idempotencyKey:key,payloadText:"บาร์โค้ดวัสดุ "+args.sku,
   payloadJson:{document_type:"recycling_barcode_label",material_id:args.productId,sku:args.sku,label_size:args.size},
   metadata:{request_source:"recycling_barcode_manual",routing_source:route.source,
    routing_purpose:route.purpose,routing_printer_device_id:route.printerDeviceId,
    copy_number:1,copy_count:1,paper_width_mm:width,label_size:args.size,
    payload_format:"receipt_html_v1",payload_html:html}
  });
 }catch(error){
  const retry=await lookup();
  if(retry.data)return [{...retry.data,fast_wake:fastWake}];
  throw error;
 }
 const queued=readEnv("VERCEL")==="1"||Boolean(readEnv("VERCEL_ENV"))||
  meta.print_mode==="agent"||meta.queue_only===true;
 const result=queued?job:(await processPrintJob(job.id))??job;
 return [{id:result.id,status:result.status,printer_id:result.printer_id,
  printed_at:result.printed_at,last_error:result.last_error,fast_wake:fastWake}];
}
