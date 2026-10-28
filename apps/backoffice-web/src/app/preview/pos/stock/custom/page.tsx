import { notFound } from "next/navigation";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { requirePosPagePermission } from "@/lib/pos-page-guard";
import { requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { getTenantPosCurrencyCode } from "@/lib/server/custom-pos-currency";
import { getCustomPosStockUiMode } from "@/lib/server/custom-stock-ui-policy";
import { formatSalesMoney } from "@/lib/pos-money";
import {getCurrentLanguage} from "@/lib/i18n";
import { PosBackButton } from "@/components/pos-preview/pos-back-button";
import { OpticalStockWorkspace } from "@/components/pos/optical-stock-workspace";
import { collectPagedShiftRows, collectShiftRowsForIds } from "@/lib/pos-shift-query-pagination";
import {getOpticalBranchScope,verifyOpticalBranch} from "@/lib/server/optical-stock-branch-scope";

export const dynamic="force-dynamic";

type CatalogRow={
  id:string;sku:string|null;name:string;category:string|null;price:number;is_active:boolean;
  sell_unit:string|null;stock_deduction_mode:string|null;
  metadata:Record<string,unknown>|null
};
type RecipeRow={product_id:string;ingredient_id:string;quantity_per_item:number};
type IngredientRow={id:string;quantity_on_hand:number};
type OpticalBin={product_id:string;kind:string;brand:string|null;model:string|null;color:string|null;
  frame_size:string|null;lens_type:string|null;lens_index:string|null;lens_sph:number|null;
  lens_cyl:number|null;on_hand:number;reserved:number;unit_price:number;currency_code:string};
type RenderRow=CatalogRow&{available:number|null;recipeAttached:boolean;
  opticalBin?:OpticalBin|null};

/**
 * No stock or contract writes. Keeps recipe-based legacy quantities visible
 * for reconciliation but does NOT migrate the item to optical_stock_bins.
 * Finance stock and queued order cutover must be reviewed separately.
 */
export default async function CustomModeStockPage({searchParams}:{searchParams?:Promise<{branch_id?:string;show_inactive?:string}>}) {
  const session=await requirePosSession();
  await assertPosMenuPageAllowed(session.session.tenant_id,"/preview/pos/stock");
  const scope=await requirePosPagePermission("inventory:view");
  const tenantId=session.session.tenant_id;
  const branches=await getOpticalBranchScope(scope);
  const params=await searchParams;
  const branchId=verifyOpticalBranch(params?.branch_id||scope.session.branch_id,branches);
  const mode=await getCustomPosStockUiMode(tenantId);
  if(mode!=="optical"&&mode!=="retail"&&mode!=="mixed")notFound();
  const optical=mode!=="retail";
  const showInactive=optical&&params?.show_inactive==="1";
  const db=getSupabaseServiceClient();
  const lang=await getCurrentLanguage();
  const [{data:products,error:productError},{data:branch,error:branchError},currency]=await Promise.all([
    optical ? collectPagedShiftRows<CatalogRow>((from,to)=>{
      const query=db.from("products")
        .select("id,sku,name,category,price,sell_unit,stock_deduction_mode,metadata,is_active")
        .eq("tenant_id",tenantId).eq("branch_id",branchId).is("deleted_at",null)
        .order("name",{ascending:true}).order("id",{ascending:true});
      return showInactive?query.range(from,to):query.eq("is_active",true).range(from,to);
    })
    : db.from("products").select("id,sku,name,category,price,sell_unit,stock_deduction_mode,metadata,is_active")
      .eq("tenant_id",tenantId).eq("branch_id",branchId).is("deleted_at",null)
      .eq("is_active",true).order("name",{ascending:true}).limit(250),
    db.from("branches").select("name").eq("tenant_id",tenantId).eq("id",branchId).maybeSingle(),
    getTenantPosCurrencyCode(tenantId)
  ]);
  if(productError||branchError)return <main role="alert" className="mx-auto max-w-4xl rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
    ไม่สามารถโหลดสต๊อกของสาขาที่ได้รับสิทธิ์ได้ กรุณาตรวจสอบกับฝ่าย IT
  </main>;
  const rows=((products??[]) as CatalogRow[]).filter(product=>{
    // Optical CUSTOM (including mixed modes) is scoped by the product's
    // optical classification. A dedicated Optical store may still have old
    // restaurant products in its legacy catalog; never display those here.
    // Retail-only CUSTOM retains its original generic stock list.
    if(!optical)return true;
    const metadata=product.metadata??{};
    if(metadata.business_mode==="optical_retail" || metadata.optical_kind==="frame" ||
       metadata.optical_kind==="lens" || metadata.optical_kind==="accessory")return true;
    return /^(กรอบแว่น|เลนส์|แว่นตา|optical|frames?|lenses?|imdc optical qa)(\s|$)/i.test(String(product.category??"").trim());
  });
  const ids=rows.map(p=>p.id);
  const recipes=ids.length?await collectShiftRowsForIds<RecipeRow>(ids,(batch,from,to)=>db.from("recipes")
    .select("product_id,ingredient_id,quantity_per_item").eq("tenant_id",tenantId)
    .eq("branch_id",branchId).in("product_id",batch)
    .order("product_id",{ascending:true}).order("ingredient_id",{ascending:true}).range(from,to))
    :{data:[] as RecipeRow[],error:null};
  if(recipes.error)return <main role="alert" className="p-6 text-rose-800">ตรวจสอบสต๊อกเดิมไม่สำเร็จ</main>;
  const links=(recipes.data??[]) as RecipeRow[];
  const ingredientIds=[...new Set(links.map(r=>r.ingredient_id))];
  const ingredients=ingredientIds.length?await collectShiftRowsForIds<IngredientRow>(ingredientIds,(batch,from,to)=>db.from("ingredients")
    .select("id,quantity_on_hand").eq("tenant_id",tenantId).eq("branch_id",branchId)
    .in("id",batch).order("id",{ascending:true}).range(from,to))
    :{data:[] as IngredientRow[],error:null};
  if(ingredients.error)return <main role="alert" className="p-6 text-rose-800">ตรวจสอบจำนวนสินค้าไม่สำเร็จ</main>;
  const stockMap=new Map(((ingredients.data??[]) as IngredientRow[]).map(i=>[i.id,Number(i.quantity_on_hand)]));
  const mapped:RenderRow[]=rows.map(p=>{
    const productRecipes=links.filter(r=>r.product_id===p.id);
    // Conservative legacy estimate only for one unambiguous ingredient. A
    // unit-only product without a verified balance MUST show "unverified".
    const recipe=productRecipes.length===1?productRecipes[0]:null;
    const onHand=recipe?stockMap.get(recipe.ingredient_id):undefined;
    const units=recipe && Number(recipe.quantity_per_item)>0 && onHand!==undefined
      ?Math.max(0,Math.floor(onHand/Number(recipe.quantity_per_item))):null;
    return {...p,available:units,recipeAttached:productRecipes.length>0};
  });
  // Verified Optical bins are authoritative for quantity/remaining. Legacy
  // recipe estimates are presented separately and never treated as verified.
  if(optical) {
    const binRows=ids.length?await collectShiftRowsForIds<OpticalBin>(ids,(batch,from,to)=>
      db.from("optical_stock_bins").select(
        "product_id,kind,brand,model,color,frame_size,lens_type,lens_index,lens_sph,lens_cyl,on_hand,reserved,unit_price,currency_code"
      ).eq("tenant_id",tenantId).eq("branch_id",branchId).in("product_id",batch)
      .order("product_id",{ascending:true}).range(from,to))
      :{data:[] as OpticalBin[],error:null};
    if(binRows.error)return <main role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-6">
      ไม่สามารถตรวจสอบสต๊อก Optical ได้ โปรดตรวจสอบกับฝ่าย IT
    </main>;
    const binMap=new Map((binRows.data??[]).map(item=>[item.product_id,item]));
    const enriched=mapped.map(row=>{
      const bin=binMap.get(row.id);
      // Do not display quantity or price under a different store currency.
      return {...row,opticalBin:bin?.currency_code===currency?bin:null};
    });
    return <OpticalStockWorkspace rows={enriched}
      branch={branch?.name??"สาขาที่ได้รับสิทธิ์"} branchId={branchId} branches={branches} currency={currency}
      canManage={["owner","manager"].includes(String(scope.session.role??"").toLowerCase())} lang={lang}
      showInactive={showInactive}/>;
  }
  const low=mapped.filter(x=>x.available===1).length;
  const out=mapped.filter(x=>x.available===0).length;
  const legacy=mapped.filter(x=>x.recipeAttached).length;
  return <main className="mx-auto w-full max-w-7xl space-y-4 px-3 pb-8 pt-3 lg:px-6" data-testid="custom-business-stock">
    <header className={`rounded-2xl border p-5 shadow-sm ${optical?"border-emerald-200 bg-gradient-to-r from-emerald-100 via-green-50 to-white":"border-blue-200 bg-gradient-to-r from-blue-100 to-white"}`}>
      <PosBackButton lang="th" href="/preview/pos/more" label="กลับเมนูเพิ่มเติม" className="mb-3"/>
      <p className="text-xs font-bold tracking-widest text-emerald-800">CUSTOM · {optical?"OPTICAL":"RETAIL"} INVENTORY</p>
      <h1 className="mt-1 text-2xl font-extrabold text-slate-900">{optical?"สต๊อกกรอบแว่นและเลนส์":"สต๊อกขายทั่วไป"}</h1>
      <p className="mt-1 text-sm text-slate-600">{branch?.name??"สาขาที่ได้รับสิทธิ์"} · ข้อมูลแยกตาม Tenant และ Branch</p>
    </header>
    <p role="note" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
      {optical?"แสดงเฉพาะรายการกรอบแว่น เลนส์ หรือสินค้าที่กำหนดเป็น Optical ไม่รวมสินค้าอาหาร/ร้านค้าทั่วไป":"ภาพรวมสต๊อกขายทั่วไป"} · ข้อมูลนี้เป็นภาพรวมสต๊อกจาก POS เดิม
      ยังไม่อนุญาตให้ปรับยอดหรือตัดสต๊อกจากหน้านี้
    </p>
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="สรุปสต๊อก">
      {[
        ["สินค้า",mapped.length],
        ["เหลือ 1",low],
        ["หมด",out],
        ["ผูกระบบสต๊อกเดิม",legacy]
      ].map(([label,value])=><div key={String(label)} className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <strong className="mt-2 block text-2xl font-extrabold text-emerald-800">{value}</strong>
      </div>)}
    </section>
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-[740px] w-full border-collapse text-sm">
        <thead><tr className="bg-emerald-50 text-left text-slate-700">
          {["สินค้า / ประเภท","SKU / บาร์โค้ด",`ราคา (${currency})`,"หน่วย","จำนวนตรวจสอบได้","สถานะ"].map(h=><th className="px-4 py-3" key={h}>{h}</th>)}
        </tr></thead>
        <tbody>{mapped.map(p=><tr className="border-t border-slate-100" key={p.id}>
          <td className="px-4 py-3"><strong>{p.name}</strong><p className="text-xs text-slate-500">{p.category||"ยังไม่ระบุประเภท"}</p></td>
          <td className="px-4 py-3 font-mono">{p.sku||"—"}</td>
          <td className="px-4 py-3 text-right font-medium">{formatSalesMoney(Number(p.price),currency)}</td>
          <td className="px-4 py-3">{p.sell_unit||"ชิ้น"}</td>
          <td className="px-4 py-3 text-right font-bold">{p.available===null?"รอตรวจ":p.available}</td>
          <td className="px-4 py-3">
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-bold ${
              p.available===null?"bg-slate-100 text-slate-600":
              p.available===0?"bg-red-100 text-red-800":
              p.available===1?"bg-amber-100 text-amber-800":
              "bg-emerald-100 text-emerald-800"}`}>
              {p.available===null?"ยังไม่ยืนยัน":p.available===0?"หมด":p.available===1?"เหลือ 1":"มีสินค้า"}
            </span>
            {p.recipeAttached?<p className="mt-1 text-[11px] text-amber-700">ยังผูกสต๊อกสูตรเดิม</p>:null}
          </td>
        </tr>)}</tbody>
      </table>
      {!mapped.length?<p className="p-5 text-center text-sm text-slate-500">ยังไม่มีสินค้าในสาขานี้</p>:null}
    </div>
    {optical?<p className="text-xs text-slate-500">รายละเอียดเฉพาะกรอบแว่น (ภาพ/รุ่น/สี/ขนาด) และเลนส์ (Index/SPH/CYL) จะใช้ตาราง Optical หลังยืนยันรายการค้างและการย้ายสต๊อกโดยไม่หักซ้ำ</p>:null}
  </main>;
}
