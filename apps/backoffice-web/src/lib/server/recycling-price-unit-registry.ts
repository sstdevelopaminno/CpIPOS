import "server-only";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {RECYCLING_PRICE_UNIT_LABELS,isRecyclingPriceUnit,isCustomRecyclingUnit,type RecyclingPriceUnit} from "@/lib/recycling-price-units";
export async function getRecyclingPriceUnits(tenantId:string,branchId:string){
 const {data,error}=await getSupabaseServiceClient().from("recycling_price_unit_registry").select("unit_code,active").eq("tenant_id",tenantId).eq("branch_id",branchId).limit(501);
 if(error||!data||data.length>500)throw Error("recycling_price_units_unavailable");
 const rows=new Map<string,boolean>(data.filter(r=>isRecyclingPriceUnit(r.unit_code)).map(r=>[String(r.unit_code),Boolean(r.active)] as const));
 return [...Object.keys(RECYCLING_PRICE_UNIT_LABELS).map(code=>({code:code as RecyclingPriceUnit,active:rows.get(code)!==false})),
  ...[...rows.entries()].filter(([code])=>isCustomRecyclingUnit(code)).map(([code,active])=>({code:code as RecyclingPriceUnit,active}))];
}
