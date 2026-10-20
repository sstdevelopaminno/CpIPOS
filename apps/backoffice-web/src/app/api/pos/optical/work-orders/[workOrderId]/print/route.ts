import {fail,ok} from "@/lib/http";
import type {AuthContext} from "@/lib/auth-context";
import {PosGuardError,requirePermission,requirePosSession} from "@/lib/pos-session-guard";
import {requireOpticalFinanceModule} from "@/lib/server/optical-finance-policy";
import {resolvePrinterRoutes} from "@/lib/printing/printer-routing-service";
import {enqueuePrintJob} from "@/lib/printing/print-service";
import {GET as loadReceipt} from "../deposit-receipt/route";

const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function context(){
 const scope=await requirePosSession();
 requirePermission(scope,"receipts:view");
 if(!await requireOpticalFinanceModule(scope.session.tenant_id,"optical_deposit"))
   throw new PosGuardError("optical_finance_disabled","Optical finance permission required.",403);
 const auth:AuthContext={
   tenantId:scope.session.tenant_id,branchId:scope.session.branch_id,
   userId:scope.session.user_id,branchRole:scope.session.role as AuthContext["branchRole"],
   platformRole:"tenant_user"
 };
 return auth;
}
async function getRoutes(){
 const auth=await context();
 const routes=await resolvePrinterRoutes({auth,purpose:"receipt",legacyRole:"receipt"});
 return {auth,routes};
}
function errorResponse(e:unknown){
 if(e instanceof PosGuardError)return fail(e.code,e.message,e.status);
 return fail("optical_printer_route_failed","ไม่สามารถตรวจสอบเครื่องพิมพ์ที่ตั้งค่าไว้",503);
}
export async function GET(_request:Request,{params}:{params:Promise<{workOrderId:string}>}){
 try{
   const {workOrderId}=await params;
   if(!uuid.test(workOrderId))return fail("invalid_order_id","รหัสใบสั่งงานไม่ถูกต้อง",422);
   const {routes}=await getRoutes();
   const selected=routes[0]??null;
   const response=ok({
     configured:Boolean(selected),
     paper_width_mm:selected?.printer.paper_width_mm===58?58:80,
     printer_name:selected?.printer.printer_name??null
   });
   response.headers.set("Cache-Control","private, no-store");
   return response;
 }catch(e){return errorResponse(e);}
}
export async function POST(request:Request,{params}:{params:Promise<{workOrderId:string}>}){
 try{
   const origin=request.headers.get("origin");
   if(origin){try{if(new URL(origin).host!==new URL(request.url).host)
       return fail("invalid_origin","Invalid print request origin.",403);}
     catch{return fail("invalid_origin","Invalid print request origin.",403);}}
   const {workOrderId}=await params;
   if(!uuid.test(workOrderId))return fail("invalid_order_id","รหัสใบสั่งงานไม่ถูกต้อง",422);
   const {auth,routes}=await getRoutes();
   if(!routes.length)return fail("receipt_printer_not_configured","กรุณาตั้งค่าเครื่องพิมพ์ใบเสร็จสำหรับสาขานี้ก่อน",409);
   const requestId=request.headers.get("x-optical-print-request")?.trim();
   if(!requestId||!uuid.test(requestId))return fail("print_request_id_required","Invalid print request id.",422);
   const statuses:string[]=[];
   for(const route of routes){
     // Reuse the existing strictly-scoped, confirmed-transaction receipt renderer.
     const url=new URL(request.url);
     url.pathname=url.pathname.replace(/\/print$/,"/deposit-receipt");
     url.search="?width="+(route.printer.paper_width_mm===58?"58":"80");
     const receipt=await loadReceipt(new Request(url.toString()),{params:Promise.resolve({workOrderId})});
     if(!receipt.ok)return fail("optical_receipt_unavailable","ต้องมีรายการรับเงินที่ยืนยันแล้วก่อนพิมพ์ใบงาน",409);
     const html=await receipt.text();
     if(!html.includes('class="barcode"')||!html.includes("data:image/svg+xml;base64,"))
       return fail("optical_receipt_invalid","Receipt barcode is missing.",503);
     for(let copy=1;copy<=Math.min(5,route.copies);copy++){
       const job=await enqueuePrintJob({
         auth,printer:route.printer,orderId:null,printerRole:"receipt",
         // Do not link an Optical work-order ID to the ordinary sales_orders FK.
         payloadText:"Optical work order "+workOrderId,
         payloadJson:{optical_work_order_id:workOrderId,receipt_type:"optical_work_order"},
         idempotencyKey:`optical:receipt:${workOrderId}:${requestId}:${route.printer.id}:${copy}`.slice(0,180),
         metadata:{
           payload_html:html,payload_format:"receipt_html_v1",
           request_source:"optical_work_order_print",paper_width_mm:route.printer.paper_width_mm,
           routing_source:route.source,routing_purpose:route.purpose,
           routing_printer_device_id:route.printerDeviceId,
           routing_runtime_device_code:route.runtimeDeviceCode,
           copy_number:copy,copy_count:route.copies,optical_work_order_id:workOrderId
         }
       });
       statuses.push(job.status);
     }
   }
   return ok({queued:statuses.length,statuses});
 }catch(e){return errorResponse(e);}
}
