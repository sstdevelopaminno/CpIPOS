import {fail,ok} from "@/lib/http";
import {requirePosSession,PosGuardError} from "@/lib/pos-session-guard";
import {FeatureGateError} from "@/lib/feature-gate";
import {requirePosApiFeature} from "@/lib/pos-api-feature-guard";
import {isAuthorizedRecyclingTenant} from "@/lib/server/recycling-pos-service";
import {getRecyclingStockBranches,requireRecyclingStockBranch} from "@/lib/server/recycling-stock-branch-scope";
import {getRecyclingPriceUnits} from "@/lib/server/recycling-price-unit-registry";
import {getSupabaseServiceClient} from "@/lib/supabase-admin";
import {isRecyclingPriceUnit,isCustomRecyclingUnit,priceUnitLabel,RECYCLING_PRICE_UNIT_LABELS} from "@/lib/recycling-price-units";
export const dynamic="force-dynamic";
async function scope(request:Request,manage:boolean){
 const s=await requirePosSession();
 const {tenant_id:tenantId}=s.session;
 if(!await isAuthorizedRecyclingTenant(tenantId))throw new PosGuardError("recycling_not_authorized","ไม่มีสิทธิ์ใช้งานโหมดค้าของเก่า",403);
 const branch=requireRecyclingStockBranch(new URL(request.url).searchParams.get("branch_id")??"",await getRecyclingStockBranches(s),manage);
 await requirePosApiFeature({tenantId,branchId:branch.id},"stock_management");
 return {tenantId,branchId:branch.id,userId:s.session.user_id};
}
function failure(e:unknown){return e instanceof PosGuardError||e instanceof FeatureGateError?fail(e.code,e.message,e.status):fail("recycling_price_units_unavailable","ไม่สามารถยืนยันผลได้ กรุณารีเฟรชรายการ",503);}
export async function GET(request:Request){
 try{const s=await scope(request,false);const response=ok({units:await getRecyclingPriceUnits(s.tenantId,s.branchId)});response.headers.set("Cache-Control","private, no-store");return response;}catch(e){return failure(e);}
}
export async function POST(request:Request){
 try{
  const s=await scope(request,true);
  const raw=await request.json().catch(()=>null) as Record<string,unknown>|null;
  if(!raw)return fail("invalid_unit","ข้อมูลหน่วยราคาไม่ถูกต้อง",422);
  let code:unknown;
  if(raw.action==="restore")code=raw.code;
  else if(raw.action==="add"&&typeof raw.label==="string"){
   const label=raw.label.normalize("NFC").trim().replace(/ +/g," ");
   code="custom:"+label;
   if(!isCustomRecyclingUnit(code)||Object.values(RECYCLING_PRICE_UNIT_LABELS).some(v=>v.toLowerCase()===label.toLowerCase())||["ตัน","ต้น"].includes(label))return fail("invalid_unit","ใช้ชื่อหน่วยภาษาไทยหรืออังกฤษ 1–24 ตัวอักษร และไม่ซ้ำหน่วยเดิม",422);
  }else return fail("invalid_unit","ข้อมูลหน่วยราคาไม่ถูกต้อง",422);
  if(!isRecyclingPriceUnit(code))return fail("invalid_unit","หน่วยราคาไม่ถูกต้อง",422);
  const units=await getRecyclingPriceUnits(s.tenantId,s.branchId);
  if(raw.action==="restore"&&!units.some(u=>u.code===code))return fail("unit_not_found","ไม่พบหน่วยราคาในสาขานี้",404);
  if(raw.action==="add"&&units.some(u=>priceUnitLabel(u.code).toLowerCase()===priceUnitLabel(code as string).toLowerCase()&&u.code!==code))return fail("duplicate_unit","ชื่อหน่วยซ้ำ กรุณาเลือกชื่ออื่น",409);
  const {error}=await getSupabaseServiceClient().rpc("recycling_set_price_unit_visibility",{p_tenant_id:s.tenantId,p_branch_id:s.branchId,p_user_id:s.userId,p_unit_code:code,p_active:true});
  if(error)return fail("unit_save_failed","ไม่สามารถเพิ่มหรือคืนหน่วยได้ (ชื่อซ้ำหรือเกินจำนวนที่กำหนด)",409);
  return ok({units:await getRecyclingPriceUnits(s.tenantId,s.branchId)});
 }catch(e){return failure(e);}
}
export async function DELETE(request:Request){
 try{
  const s=await scope(request,true);const raw=await request.json().catch(()=>null) as Record<string,unknown>|null;
  if(!raw||raw.confirmed!==true||!isRecyclingPriceUnit(raw.code))return fail("invalid_unit","กรุณายืนยันการลบหน่วย",422);
  const units=await getRecyclingPriceUnits(s.tenantId,s.branchId);
  if(!units.some(u=>u.code===raw.code))return fail("unit_not_found","ไม่พบหน่วยในสาขานี้",404);
  const {error}=await getSupabaseServiceClient().rpc("recycling_set_price_unit_visibility",{p_tenant_id:s.tenantId,p_branch_id:s.branchId,p_user_id:s.userId,p_unit_code:raw.code,p_active:false});
  if(error)return fail("unit_delete_failed","ไม่สามารถลบหน่วยได้ กรุณาตรวจสอบอีกครั้ง",409);
  return ok({units:await getRecyclingPriceUnits(s.tenantId,s.branchId)});
 }catch(e){return failure(e);}
}
