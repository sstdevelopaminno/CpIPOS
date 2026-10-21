import {fail,ok} from "@/lib/http";
import {PosGuardError,requirePermission,requirePosSession} from "@/lib/pos-session-guard";
import {requireOpticalRetailEntitlement} from "@/lib/server/optical-entitlement";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";

/** Read-only overview of MADE-TO-ORDER jobs. No deposit, stock or QR side effects.
 * Finance writes remain disabled until separately approved and E2E verified. */
export async function GET(){
  try{
    const scope=await requirePosSession();
    requirePermission(scope,"sales:list:view");
    if(!await requireOpticalRetailEntitlement(scope.session.tenant_id))
      return fail("optical_mode_denied","CUSTOM Optical is not enabled for this store.",403);
    const tenantId=scope.session.tenant_id,branchId=scope.session.branch_id;
    const client=getSupabaseServiceClient();
    const {data,error}=await client.from("optical_work_orders")
      .select("id,customer_id,status,currency_code,total_amount,paid_total,accepted_at,due_at,created_at")
      .eq("tenant_id",tenantId).eq("branch_id",branchId)
      .order("created_at",{ascending:false}).limit(80);
    if(error)return fail("optical_work_orders_unavailable","Cannot load Optical work orders.",503);
    const customers=[...new Set((data??[]).map(row=>String(row.customer_id??"")).filter(Boolean))];
    let names=new Map<string,{full_name:string;customer_code:string}>();
    if(customers.length){
      const result=await client.from("optical_customers")
        .select("id,full_name,customer_code")
        .eq("tenant_id",tenantId).eq("branch_id",branchId)
        .in("id",customers);
      if(result.error)return fail("optical_customers_unavailable","Cannot load the linked customers.",503);
      names=new Map((result.data??[]).map(row=>[String(row.id),
        {full_name:String(row.full_name??""),customer_code:String(row.customer_code??"")}]));
    }
    const response=ok({orders:(data??[]).map(row=>({
      ...row,customer:names.get(String(row.customer_id))??null
    }))});
    response.headers.set("Cache-Control","private, no-store");
    return response;
  }catch(error){
    if(error instanceof PosGuardError)return fail(error.code,error.message,error.status);
    return fail("optical_work_orders_unavailable","Unable to load work orders.",503);
  }
}
