import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { renderOpticalDepositReceipt80mm } from "@/lib/optical/optical-deposit-receipt-80mm";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { requireOpticalFinanceModule } from "@/lib/server/optical-finance-policy";
import {buildOpticalPickupBarcode,type OpticalBillSnapshot} from "@/lib/optical/optical-deposit-contract";
import {loadReceiptStoreProfile} from "@/lib/services/store-profile-service";
import {getCurrentLanguage} from "@/lib/i18n";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function unavailable(status=403) {
  return new Response("Optical deposit receipt unavailable.",{status,headers:{"Cache-Control":"no-store"}});
}
export async function GET(request:Request,{params}:{params:Promise<{workOrderId:string}>}) {
  try {
    const scope=await requirePosSession();
    requirePermission(scope,"receipts:view");
    if(!await requireOpticalFinanceModule(scope.session.tenant_id,"optical_deposit"))return unavailable();
    const {workOrderId}=await params;
    if(!uuid.test(workOrderId))return unavailable(422);
    const client=getSupabaseServiceClient();
    const tenantId=scope.session.tenant_id,branchId=scope.session.branch_id;
    const [{data:order,error:orderError},{data:lines,error:lineError},
      {data:payment,error:paymentError},{data:branch,error:branchError},{data:tenant,error:tenantError}]=await Promise.all([
      client.from("optical_work_orders").select("id,tenant_id,branch_id,status,total_amount,paid_total,currency_code,customer_id,due_at")
        .eq("id",workOrderId).eq("tenant_id",tenantId).eq("branch_id",branchId).maybeSingle(),
      client.from("optical_work_order_lines").select("description_snapshot,quantity,line_total")
        .eq("work_order_id",workOrderId).eq("tenant_id",tenantId).eq("branch_id",branchId),
      client.from("optical_payment_ledger").select("id,method,received_at,received_by")
        .eq("work_order_id",workOrderId).eq("tenant_id",tenantId).eq("branch_id",branchId)
        .order("received_at",{ascending:false}).limit(1).maybeSingle(),
      client.from("branches").select("name").eq("id",branchId).eq("tenant_id",tenantId).maybeSingle(),
      client.from("tenants").select("name,display_name").eq("id",tenantId).maybeSingle()
    ]);
    if(orderError||lineError||paymentError||branchError||tenantError||!order||!payment||!lines?.length)return unavailable(404);
    const bill:OpticalBillSnapshot={
      tenantId,branchId,orderId:order.id,currencyCode:"LAK",
      totalAmount:Number(order.total_amount),paidAmount:Number(order.paid_total),
      status:order.status==="cancelled"?"cancelled":order.status==="collected"?"paid":
        Number(order.paid_total)>=Number(order.total_amount)?"paid":
        Number(order.paid_total)>0?"partially_paid":"unpaid"
    };
    if(!buildOpticalPickupBarcode(order.id))return unavailable(409);
    const width=new URL(request.url).searchParams.get("width")==="58"?58:80;
    // Payment receiver is an auth user ID, never a customer-facing employee name.
    // Read the current profile at print time, scoped to a validated Optical receipt.
    const {data:cashier,error:cashierError}=await client.from("users_profiles")
      .select("full_name").eq("id",payment.received_by).maybeSingle();
    if(cashierError)return unavailable(503);
    const cashierName=String(cashier?.full_name??"").trim()||"—";
    const [profile,language,billNo,receiptNo]=await Promise.all([
      loadReceiptStoreProfile(tenantId),getCurrentLanguage(),
      client.from("optical_document_numbers").select("document_number")
        .eq("tenant_id",tenantId).eq("branch_id",branchId).eq("kind","bill")
        .eq("source_id",order.id).maybeSingle(),
      client.from("optical_document_numbers").select("document_number")
        .eq("tenant_id",tenantId).eq("branch_id",branchId).eq("kind","receipt")
        .eq("source_id",payment.id).maybeSingle()
    ]);
    if(billNo.error||receiptNo.error||!billNo.data||!receiptNo.data)return unavailable(503);
    const documentBillNumber=String(billNo.data.document_number).padStart(6,"0");
    const documentReceiptNumber=String(receiptNo.data.document_number).padStart(6,"0");
    const receipt=renderOpticalDepositReceipt80mm({
      bill,receiptNumber:documentReceiptNumber,documentReceiptNumber,documentBillNumber,
      language,storeName:profile?.display_name||tenant?.display_name||tenant?.name||"Optical",
      storeAddress:profile?.company_address??null,storePhone:profile?.contact_phone??null,
      storeLogoUrl:profile?.logo_url??null,
      branchName:branch?.name??branchId,createdAtIso:payment.received_at,
      cashierName,
      paymentMethod:payment.method==="bank_transfer"?"bank_transfer":"cash",
      items:lines.map(row=>({description:row.description_snapshot,
        quantity:Number(row.quantity),lineTotal:Number(row.line_total)})),
      receiptWidthMm:width,pickupDateIso:order.due_at
    });
    // HTML preview only: never dispatch a thermal printer without a committed
    // receipt-print queue idempotency check and explicit cashier request.
    return new Response(receipt,{status:200,headers:{
      "Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store, private",
      "X-Content-Type-Options":"nosniff","Content-Security-Policy":"default-src 'none'; img-src 'self' https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
    }});
  }catch(error){
    return error instanceof PosGuardError?unavailable(error.status):unavailable(503);
  }
}
