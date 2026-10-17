import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { requireOpticalFinanceModule } from "@/lib/server/optical-finance-policy";

export async function GET() {
  try {
    const scope=await requirePosSession();
    requirePermission(scope,"sales:list:view");
    if(!await requireOpticalFinanceModule(scope.session.tenant_id,"optical_inventory"))
      return fail("optical_inventory_disabled","Optical stock module has not been approved.",403);
    const {data,error}=await getSupabaseServiceClient().from("optical_stock_bins")
      .select("product_id,kind,brand,model,color,frame_size,lens_index,lens_type,image_url,unit,unit_price,on_hand,reserved,reorder_level")
      .eq("tenant_id",scope.session.tenant_id).eq("branch_id",scope.session.branch_id)
      .order("created_at",{ascending:false}).limit(200);
    if(error)return fail("optical_inventory_unavailable","Unable to read Optical inventory.",503);
    const ids=(data??[]).map(item=>item.product_id);
    const products=ids.length?await getSupabaseServiceClient().from("products")
      .select("id,sku,name").eq("tenant_id",scope.session.tenant_id)
      .eq("branch_id",scope.session.branch_id).in("id",ids)
      :{data:[],error:null};
    if(products.error)return fail("optical_inventory_product_unavailable","Unable to read Optical product details.",503);
    const names=new Map((products.data??[]).map(p=>[p.id,p]));
    return ok({items:(data??[]).map(item=>({...item,
      sku:names.get(item.product_id)?.sku??"",name:names.get(item.product_id)?.name??"",
      available:Number(item.on_hand)-Number(item.reserved)}))});
  }catch(error){
    return error instanceof PosGuardError?fail(error.code,error.message,error.status)
      : fail("optical_inventory_unavailable","Optical inventory is currently unavailable.",503);
  }
}
