import {NextResponse} from "next/server";
import {requirePosSession,requirePermission,PosGuardError} from "@/lib/pos-session-guard";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {getCustomPosStockUiMode} from "@/lib/server/custom-stock-ui-policy";
import {requireOpticalRetailEntitlement} from "@/lib/server/optical-entitlement";
import {getOpticalBranchScope,verifyOpticalBranch} from "@/lib/server/optical-stock-branch-scope";
import {collectPagedShiftRows,collectShiftRowsForIds} from "@/lib/pos-shift-query-pagination";
export const dynamic="force-dynamic";

type Sale={id:string};
type Item={product_id:string|null;quantity:number;line_total:number};
type Product={id:string;name:string;sku:string|null;category:string|null;metadata:Record<string,unknown>|null};
const CHUNK=100;
const isOptical=(p:Product)=>p.metadata?.business_mode==="optical_retail"||
 ["frame","lens","accessory"].includes(String(p.metadata?.optical_kind??""))||
 /^(กรอบแว่น|เลนส์|แว่นตา|optical|frames?|lenses?|imdc optical qa)(\s|$)/i.test(String(p.category??"").trim());
export async function GET(req:Request){
 try{
  const scope=await requirePosSession();
  requirePermission(scope,"inventory:view");
  const tenant=scope.session.tenant_id;
  const mode=await getCustomPosStockUiMode(tenant);
  if(!["optical","mixed"].includes(mode)||!await requireOpticalRetailEntitlement(tenant))
    return NextResponse.json({error:{message:"เฉพาะ CUSTOM Optical"}},{status:403});
  const branches=await getOpticalBranchScope(scope);
  const branch=verifyOpticalBranch(new URL(req.url).searchParams.get("branch_id")||scope.session.branch_id,branches);
  const db=getSupabaseServiceClient();
  const since=new Date(Date.now()-30*24*3600*1000).toISOString();
  // Bound scan to avoid expensive timeouts; distinguish sample from a complete ranking.
  const orderIds:string[]=[];
  let truncated=false;
  for(let from=0;from<=2000;from+=500){
    const {data,error}=await db.from("orders").select("id")
      .eq("tenant_id",tenant).eq("branch_id",branch).eq("status","completed")
      .gte("created_at",since).order("created_at",{ascending:false}).order("id",{ascending:false})
      .range(from,from+499);
    if(error)throw error;
    for(const o of (data??[]) as Sale[])orderIds.push(o.id);
    if((data??[]).length<500)break;
  }
  if(orderIds.length>2000){orderIds.length=2000;truncated=true;}
  const aggregation=new Map<string,{quantity:number;revenue:number}>();
  for(let i=0;i<orderIds.length;i+=CHUNK){
    const batch=orderIds.slice(i,i+CHUNK);
    const result=await collectPagedShiftRows<Item>((from,to)=>db.from("order_items")
      .select("product_id,quantity,line_total").eq("tenant_id",tenant)
      .eq("branch_id",branch).in("order_id",batch).gt("quantity",0)
      .order("product_id",{ascending:true}).order("id",{ascending:true}).range(from,to));
    if(result.error)throw result.error;
    for(const item of result.data??[]){
      if(!item.product_id)continue;
      const sum=aggregation.get(item.product_id)??{quantity:0,revenue:0};
      sum.quantity+=Number(item.quantity??0);
      sum.revenue+=Number(item.line_total??0);
      aggregation.set(item.product_id,sum);
    }
  }
  const ids=[...aggregation.keys()];
  const productResult=ids.length?await collectShiftRowsForIds<Product>(ids,(batch,from,to)=>db.from("products")
    .select("id,name,sku,category,metadata").eq("tenant_id",tenant).eq("branch_id",branch)
    .in("id",batch).order("id",{ascending:true}).range(from,to))
    :{data:[] as Product[],error:null};
  if(productResult.error)throw productResult.error;
  const products=(productResult.data??[]).filter(isOptical);
  const rows=products.map(p=>({
     product_id:p.id,name:p.name,sku:p.sku,
     units:Number(aggregation.get(p.id)!.quantity.toFixed(3)),
     revenue:Number(aggregation.get(p.id)!.revenue.toFixed(2))
   })).sort((a,b)=>b.units-a.units||b.revenue-a.revenue||a.name.localeCompare(b.name)).slice(0,10);
  return NextResponse.json({data:{branch_id:branch,period_days:30,ranked:rows,
    sampled:truncated,order_count:orderIds.length},error:null},{
      headers:{"Cache-Control":"private, no-store"}
    });
 }catch(e){
  if(e instanceof PosGuardError)return NextResponse.json({error:{message:e.message}},{status:e.status});
  console.error("[optical-best-sellers]",e);
  return NextResponse.json({error:{message:"ไม่สามารถสรุปสินค้าขายดีได้ กรุณาลองใหม่"}},{status:503});
 }
}
