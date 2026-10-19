import { NextResponse } from "next/server";
import type { BranchRole } from "@pos/shared-types";
import { appendAuditLog } from "@/lib/audit-log";
import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { getCustomPosStockUiMode } from "@/lib/server/custom-stock-ui-policy";
import { requireOpticalRetailEntitlement } from "@/lib/server/optical-entitlement";
import { isOpticalItApiControlAllowed,OPTICAL_IT_API_CONTROLS } from "@/lib/server/optical-finance-policy";
import { getTenantPosCurrencyCode } from "@/lib/server/custom-pos-currency";
import { collectPagedShiftRows } from "@/lib/pos-shift-query-pagination";
import {getOpticalBranchScope,verifyOpticalBranch} from "@/lib/server/optical-stock-branch-scope";

/**
 * Optical-specific catalog writes only. Stock quantities / inventory movements
 * belong to the dedicated audited stock-cutover workflow, never to this route.
 * The shared restaurant and general CUSTOM product flows are untouched.
 */
type Kind = "frame" | "lens" | "accessory";
type ProductInput = {name?:unknown;sku?:unknown;kind?:unknown;price?:unknown;unit?:unknown;note?:unknown;
  brand?:unknown;model?:unknown;color?:unknown;frame_size?:unknown;
  lens_name?:unknown;lens_index?:unknown;lens_sph?:unknown;lens_cyl?:unknown;lens_axis?:unknown};
const categories:Record<Kind,string> = {frame:"กรอบแว่น",lens:"เลนส์",accessory:"อุปกรณ์เสริม"};
const safe=(v:unknown,max:number)=>typeof v==="string"?v.trim().slice(0,max):"";
function response(code:string,message:string,status:number) {
  return NextResponse.json({data:null,error:{code,message}},{status});
}
function parseItem(input:ProductInput,currency:string) {
  const name=safe(input.name,180),sku=safe(input.sku,90),unit=safe(input.unit,30)||"ชิ้น";
  const note=safe(input.note,500);
  const brand=safe(input.brand,120),model=safe(input.model,120),
    color=safe(input.color,80),frame_size=safe(input.frame_size,60),
    lens_name=safe(input.lens_name,120),lens_index=safe(input.lens_index,40);
  const numeric=(raw:unknown,min:number,max:number)=>{
    if(raw===null||raw===undefined||raw==="")return null;
    const value=Number(raw);
    if(!Number.isFinite(value)||value<min||value>max)throw new PosGuardError(
      "optical_catalog_prescription_invalid","ค่าสายตาต้องเป็นตัวเลขในช่วงที่กำหนด",422);
    return value;
  };
  const lens_sph=numeric(input.lens_sph,-30,30),
    lens_cyl=numeric(input.lens_cyl,-15,15),lens_axis=numeric(input.lens_axis,0,180);
  const kind=input.kind as Kind;
  const price=Number(input.price);
  if(!name||!sku||!Object.prototype.hasOwnProperty.call(categories,kind)) {
    throw new PosGuardError("optical_catalog_required","ชื่อสินค้า ประเภท และ SKU / บาร์โค้ด จำเป็นต้องกรอก",422);
  }
  if(!/^[^\s,;()]{1,90}$/.test(sku)) {
    throw new PosGuardError("optical_catalog_sku_invalid","SKU / บาร์โค้ด ต้องไม่มีช่องว่างหรือเครื่องหมายพิเศษที่ไม่รองรับ",422);
  }
  if(!Number.isFinite(price)||price<0||price>999999999||
    (currency==="LAK"&&!Number.isInteger(price))||
    Math.round(price*100)/100!==price) {
    throw new PosGuardError("optical_catalog_price_invalid","ราคาสินค้าไม่ถูกต้อง หรือมีทศนิยมเกินที่สกุลเงินรองรับ",422);
  }
  return {name,sku,kind,unit,note,price,category:categories[kind],
    brand,model,color,frame_size,lens_name,lens_index,lens_sph,lens_cyl,lens_axis};
}
function ownOrigin(request:Request) {
  const origin=request.headers.get("origin");
  if(!origin)return true;
  try{return new URL(origin).host===new URL(request.url).host;}catch{return false;}
}
async function context(request:Request,requestedBranchId?:string|null) {
  if(!ownOrigin(request))throw new PosGuardError("origin_forbidden","Invalid request origin",403);
  const scope=await requirePosSession();
  requirePermission(scope,"inventory:view");
  const branches=await getOpticalBranchScope(scope);
  const branchId=verifyOpticalBranch(requestedBranchId||scope.session.branch_id,branches);
  await requireTenantFeature(scope.session.tenant_id,"stock_management",branchId);
  const mode=await getCustomPosStockUiMode(scope.session.tenant_id);
  if((mode!=="optical"&&mode!=="mixed") ||
    !await requireOpticalRetailEntitlement(scope.session.tenant_id)) {
    throw new PosGuardError("optical_catalog_forbidden","This store is not IT-authorized CUSTOM Optical.",403);
  }
  if(!await isOpticalItApiControlAllowed(scope.session.tenant_id,OPTICAL_IT_API_CONTROLS.optical_inventory))
    throw new PosGuardError("optical_inventory_it_disabled","IT disabled Optical inventory API.",403);
  const role=String(scope.session.role??"").toLowerCase();
  if(role!=="owner"&&role!=="manager") {
    throw new PosGuardError("optical_catalog_role_forbidden","Only an owner or manager can change Optical products.",403);
  }
  const currency=await getTenantPosCurrencyCode(scope.session.tenant_id);
  return {scope,branchId,currency,db:getSupabaseServiceClient()};
}
async function audit(ctx:Awaited<ReturnType<typeof context>>,action:string,ids:string[]) {
  for(const id of ids.slice(0,50)){
    try{await appendAuditLog({
      tenantId:ctx.scope.session.tenant_id,
      branchId:ctx.branchId,
      actorUserId:ctx.scope.session.user_id,
      actorRole:ctx.scope.session.role as BranchRole,
      action,targetTable:"products",targetId:id,
      metadata:{catalog:"custom_optical"}
    });}catch(error){console.error("[optical-catalog] audit append failed",error);}
  }
}
function catchError(error:unknown) {
  if(error instanceof PosGuardError)return response(error.code,error.message,error.status);
  if(error instanceof FeatureGateError)return response(error.code,error.message,error.status);
  console.error("[optical-catalog] unexpected failure",error);
  return response("optical_catalog_failed","ไม่สามารถดำเนินการได้ กรุณาลองใหม่หรือติดต่อ IT",500);
}
function isOpticalProduct(product:{category?:string|null;metadata?:Record<string,unknown>|null}) {
  const meta=product.metadata??{};
  return meta.business_mode==="optical_retail"||
    meta.optical_kind==="frame"||meta.optical_kind==="lens"||meta.optical_kind==="accessory"||
    /^(กรอบแว่น|เลนส์|แว่นตา|optical|frames?|lenses?|imdc optical qa)(\s|$)/i.test(String(product.category??"").trim());
}
async function findProduct(ctx:Awaited<ReturnType<typeof context>>,id:string) {
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(id))return null;
  const {data,error}=await ctx.db.from("products")
    .select("id,name,sku,price,category,sell_unit,metadata,stock_deduction_mode")
    .eq("id",id).eq("tenant_id",ctx.scope.session.tenant_id)
    .eq("branch_id",ctx.branchId)
    .is("deleted_at",null).maybeSingle();
  if(error)throw new Error(error.message);
  return data && isOpticalProduct(data)?data:null;
}
async function skuTaken(ctx:Awaited<ReturnType<typeof context>>,skus:string[],exceptId?:string) {
  // Match case-insensitively even though the DB unique index is case-sensitive.
  // Page through the full branch catalog: PostgREST caps a single response.
  const result=await collectPagedShiftRows<{id:string;sku:string}>((from,to)=>
    ctx.db.from("products").select("id,sku")
      .eq("tenant_id",ctx.scope.session.tenant_id)
      .eq("branch_id",ctx.branchId)
      .order("id",{ascending:true}).range(from,to)
  );
  if(result.error)throw new Error("Scoped SKU validation unavailable");
  const set=new Set(skus.map(x=>x.toLocaleLowerCase()));
  return (result.data??[]).some(p=>p.id!==exceptId && set.has(String(p.sku).toLocaleLowerCase()));
}

export async function POST(request:Request){
  try{
    const body=await request.json().catch(()=>null) as {items?:ProductInput[];branch_id?:string}|null;
    const ctx=await context(request,body?.branch_id);
    if(!body||!Array.isArray(body.items)||body.items.length<1||body.items.length>50)
      return response("optical_catalog_batch_invalid","เพิ่มสินค้าได้ครั้งละ 1–50 รายการ",422);
    const items=body.items.map(row=>parseItem(row,ctx.currency));
    const keys=items.map(row=>row.sku.toLocaleLowerCase());
    if(new Set(keys).size!==keys.length||await skuTaken(ctx,items.map(x=>x.sku))) {
      return response("optical_catalog_sku_duplicate","SKU / บาร์โค้ด ซ้ำกับรายการในฟอร์มหรือภายในสาขา",409);
    }
    const {data,error}=await ctx.db.from("products").insert(items.map(row=>({
      tenant_id:ctx.scope.session.tenant_id,branch_id:ctx.branchId,
      name:row.name,sku:row.sku,category:row.category,price:row.price,sell_unit:row.unit,
      stock_deduction_mode:"unit_only",is_combo:false,is_active:true,
      metadata:{business_mode:"optical_retail",optical_kind:row.kind,
        optical_note:row.note,currency_code:ctx.currency,stock_verification:"pending",
        optical_brand:row.brand,optical_model:row.model,optical_color:row.color,
        optical_frame_size:row.frame_size,optical_lens_name:row.lens_name,
        optical_lens_index:row.lens_index,optical_lens_sph:row.lens_sph,
        optical_lens_cyl:row.lens_cyl,optical_lens_axis:row.lens_axis}
    }))).select("id,sku");
    if(error)return response(error.code==="23505"?"optical_catalog_sku_duplicate":"optical_catalog_insert_failed",
      error.code==="23505"?"SKU / บาร์โค้ด ซ้ำภายในสาขา":"บันทึกสินค้าไม่สำเร็จ",error.code==="23505"?409:500);
    await audit(ctx,"optical_catalog_created",(data??[]).map(x=>x.id));
    return NextResponse.json({data:{count:data?.length??0},error:null},{status:201});
  }catch(error){return catchError(error);}
}
export async function PATCH(request:Request){
  try{
    const body=await request.json().catch(()=>null) as {id?:string;item?:ProductInput;branch_id?:string}|null;
    const ctx=await context(request,body?.branch_id);
    const product=await findProduct(ctx,String(body?.id??""));
    if(!product)return response("optical_catalog_not_found","ไม่พบสินค้า Optical ในสาขานี้",404);
    if(!body?.item)return response("optical_catalog_invalid","ข้อมูลสินค้าไม่ครบ",422);
    const item=parseItem(body.item,ctx.currency);
    if(await skuTaken(ctx,[item.sku],product.id))
      return response("optical_catalog_sku_duplicate","SKU / บาร์โค้ด ซ้ำภายในสาขา",409);
    const {data:bin,error:binError}=await ctx.db.from("optical_stock_bins")
      .select("id,kind,unit_price,brand,model,color,frame_size,lens_index,lens_sph,lens_cyl")
      .eq("tenant_id",ctx.scope.session.tenant_id)
      .eq("branch_id",ctx.branchId).eq("product_id",product.id).maybeSingle();
    if(binError)return response("optical_catalog_inventory_check_failed","ตรวจสอบสต๊อกสินค้าไม่สำเร็จ",503);
    if(bin && (bin.kind!==item.kind || Number(bin.unit_price)!==item.price)) {
      return response("optical_catalog_inventory_linked",
        "สินค้านี้เชื่อมสต๊อก Optical แล้ว การเปลี่ยนราคา/ประเภทต้องผ่านระบบปรับสต๊อกที่ตรวจสอบได้",409);
    }
    const metadata=product.metadata && typeof product.metadata==="object"?product.metadata:{};
    // Optical stock bins are authoritative. Never silently rewrite a linked
    // brand, model, color, size or prescription from a legacy product mutation.
    if(bin && (String(bin.brand??"")!==item.brand ||
      (bin.kind==="frame" && (String(bin.model??"")!==item.model ||
        String(bin.color??"")!==item.color || String(bin.frame_size??"")!==item.frame_size)) ||
      (bin.kind==="lens" && (String(bin.model??"")!==item.lens_name ||
        String(bin.lens_index??"")!==item.lens_index ||
        (bin.lens_sph??null)!==item.lens_sph ||
        (bin.lens_cyl??null)!==item.lens_cyl)))) {
      return response("optical_catalog_stock_linked",
        "สินค้าที่เชื่อมสต๊อก Optical แล้วต้องแก้ข้อมูลรุ่น/ค่าสายตาผ่านการตรวจสอบสต๊อก",409);
    }
    const {error}=await ctx.db.from("products").update({
      name:item.name,sku:item.sku,category:item.category,price:item.price,sell_unit:item.unit,
      metadata:{...metadata,business_mode:"optical_retail",optical_kind:item.kind,
        optical_note:item.note,optical_brand:item.brand,optical_model:item.model,
        optical_color:item.color,optical_frame_size:item.frame_size,
        optical_lens_name:item.lens_name,optical_lens_index:item.lens_index,
        optical_lens_sph:item.lens_sph,optical_lens_cyl:item.lens_cyl,
        optical_lens_axis:item.lens_axis},
      updated_at:new Date().toISOString()
    }).eq("id",product.id).eq("tenant_id",ctx.scope.session.tenant_id)
      .eq("branch_id",ctx.branchId).is("deleted_at",null);
    if(error)return response(error.code==="23505"?"optical_catalog_sku_duplicate":"optical_catalog_update_failed",
      error.code==="23505"?"SKU / บาร์โค้ด ซ้ำภายในสาขา":"แก้ไขสินค้าไม่สำเร็จ",error.code==="23505"?409:500);
    await audit(ctx,"optical_catalog_updated",[product.id]);
    return NextResponse.json({data:{updated:true},error:null});
  }catch(error){return catchError(error);}
}
export async function DELETE(request:Request){
  try{
    const body=await request.json().catch(()=>null) as {id?:string;branch_id?:string}|null;
    const ctx=await context(request,body?.branch_id);
    const product=await findProduct(ctx,String(body?.id??""));
    if(!product)return response("optical_catalog_not_found","ไม่พบสินค้า Optical ในสาขานี้",404);
    // Deleting an inventory-linked SKU could break outstanding reservations,
    // receipts or legacy recipes: require a separate stock cutover instead.
    const refs=await Promise.all([
      ctx.db.from("optical_stock_bins").select("id").eq("tenant_id",ctx.scope.session.tenant_id)
        .eq("branch_id",ctx.branchId).eq("product_id",product.id).limit(1),
      ctx.db.from("recipes").select("product_id").eq("tenant_id",ctx.scope.session.tenant_id)
        .eq("branch_id",ctx.branchId).eq("product_id",product.id).limit(1),
      ctx.db.from("optical_work_order_lines").select("id").eq("tenant_id",ctx.scope.session.tenant_id)
        .eq("branch_id",ctx.branchId).eq("product_id",product.id).limit(1)
    ]);
    if(refs.some(r=>r.error))return response("optical_catalog_reference_check_failed","ตรวจสอบรายการอ้างอิงไม่สำเร็จ",503);
    if(refs.some(r=>(r.data??[]).length>0))return response("optical_catalog_in_use",
      "สินค้านี้ยังมีข้อมูลสต๊อก สูตร หรือใบสั่งงานอ้างอิง กรุณาติดต่อผู้จัดการเพื่อตรวจสอบก่อนลบ",409);
    const {error}=await ctx.db.from("products").update({
      is_active:false,deleted_at:new Date().toISOString(),
      deleted_by:ctx.scope.session.user_id,delete_reason:"optical_catalog_soft_delete"
    }).eq("id",product.id).eq("tenant_id",ctx.scope.session.tenant_id)
      .eq("branch_id",ctx.branchId).is("deleted_at",null);
    if(error)return response("optical_catalog_delete_failed","ไม่สามารถลบสินค้าได้",500);
    await audit(ctx,"optical_catalog_soft_deleted",[product.id]);
    return NextResponse.json({data:{deleted:true},error:null});
  }catch(error){return catchError(error);}
}