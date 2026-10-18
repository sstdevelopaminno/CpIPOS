import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { parseOpticalBillRecallCode } from "@/lib/optical/optical-deposit-contract";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { requireOpticalFinanceModule } from "@/lib/server/optical-finance-policy";

/** Scanning a customer deposit receipt ONLY locates a previously paid Optical
 * job. Never use the QR as a payment token or order-collection authorization. */
export async function GET(request: Request) {
  try {
    const scope=await requirePosSession();
    requirePermission(scope,"sales:list:view");
    if(!await requireOpticalFinanceModule(scope.session.tenant_id,"optical_deposit"))
      return fail("optical_recall_disabled","Deposit recall is not enabled for this store.",403);
    const id=parseOpticalBillRecallCode(new URL(request.url).searchParams.get("code")??"");
    if(!id)return fail("invalid_optical_recall","Invalid QR or bill reference.",422);
    const client=getSupabaseServiceClient();
    const tenantId=scope.session.tenant_id,branchId=scope.session.branch_id;
    const {data,error}=await client.from("optical_work_orders")
      .select("id,status,total_amount,paid_total,currency_code,customer_id,due_at")
      .eq("id",id).eq("tenant_id",tenantId).eq("branch_id",branchId).maybeSingle();
    if(error)return fail("optical_recall_failed","Unable to locate the bill.",503);
    if(!data)return fail("optical_bill_not_found","No bill in this branch.",404);
    const total=Number(data.total_amount),paid=Number(data.paid_total);
    if(!Number.isSafeInteger(total)||!Number.isSafeInteger(paid)||total<=0||paid<=0||paid>total
      ||data.currency_code!=="LAK"||["cancelled","collected"].includes(String(data.status)))
      return fail("optical_bill_not_collectable","No outstanding or pickup-ready bill is available.",409);
    // Show the actual recorded job items, NEVER scan a receipt into product SKU
    // input or create a duplicate order in the existing retail POS cart.
    const {data:lines,error:linesError}=await client.from("optical_work_order_lines")
      .select("description_snapshot,sku_snapshot,quantity")
      .eq("work_order_id",id).eq("tenant_id",tenantId).eq("branch_id",branchId)
      .limit(30);
    if(linesError||!lines?.length)return fail("optical_recall_lines_unavailable","Unable to read verified job items.",503);
    const remaining=total-paid;
    const state=remaining>0?"balance_due":data.status==="ready_for_pickup"?"pickup_ready":"paid_waiting_for_job";
    const response=ok({
      bill:{id:data.id,status:data.status,total_amount:total,paid_total:paid,
        currency_code:"LAK",due_at:data.due_at},
      remaining_amount:remaining,
      recall_state:state,
      items:lines.map(line=>({
        description:String(line.description_snapshot??""),
        sku:String(line.sku_snapshot??""),
        quantity:Number(line.quantity)
      }))
    });
    response.headers.set("Cache-Control","no-store, private");
    return response;
  }catch(error){
    return error instanceof PosGuardError
      ? fail(error.code,error.message,error.status)
      : fail("optical_recall_failed","Unable to validate the Optical bill.",503);
  }
}
