import { NextResponse } from "next/server";
import { FeatureGateError, requireTenantFeature } from "@/lib/feature-gate";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { requireOpticalRetailEntitlement } from "@/lib/server/optical-entitlement";
import { getCustomPosStockUiMode } from "@/lib/server/custom-stock-ui-policy";
import { getOpticalBranchScope, verifyOpticalBranch } from "@/lib/server/optical-stock-branch-scope";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(code: string, message: string, status: number) {
  return NextResponse.json({data:null,error:{code,message}},{status});
}
/** Stock counts may only change through the audited atomic DB transaction.
 * SKU scanner input does not write until the user explicitly confirms.
 * Never use legacy restaurant ingredient stock or mutate prices/payments here.
 */
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== new URL(request.url).host)
      return fail("origin_forbidden","Invalid request origin",403);
    const scope = await requirePosSession();
    requirePermission(scope,"inventory:view");
    if (!["owner","manager"].includes(String(scope.session.role).toLowerCase()))
      return fail("optical_stock_role_forbidden","Owner or manager required for stock adjustments",403);
    const body = await request.json().catch(()=>null) as {
      branch_id?:string;sku?:string;direction?:"receive"|"issue";
      quantity?:number;note?:string;request_id?:string
    }|null;
    const sku=String(body?.sku??"").trim();
    const note=String(body?.note??"").trim();
    const quantity=Number(body?.quantity);
    const direction=body?.direction;
    if (!uuid.test(String(body?.request_id??"")) ||
        !/^[^\s,;()]{1,90}$/.test(sku) ||
        !Number.isInteger(quantity) || quantity<1 || quantity>100000 ||
        !["receive","issue"].includes(String(direction)) ||
        note.length<3 || note.length>300)
      return fail("optical_stock_invalid","ตรวจสอบบาร์โค้ด จำนวน และเหตุผลการปรับสต๊อก",422);
    const branches=await getOpticalBranchScope(scope);
    const branchId=verifyOpticalBranch(body?.branch_id||scope.session.branch_id,branches);
    await requireTenantFeature(scope.session.tenant_id,"stock_management",branchId);
    if (!await requireOpticalRetailEntitlement(scope.session.tenant_id) ||
        !["optical","mixed"].includes(await getCustomPosStockUiMode(scope.session.tenant_id)))
      return fail("optical_stock_mode_denied","Only IT-approved CUSTOM Optical may adjust this stock",403);
    const delta=direction==="receive"?quantity:-quantity;
    const {data,error}=await getSupabaseServiceClient().rpc("optical_adjust_stock_tx",{
      p_tenant_id:scope.session.tenant_id,p_branch_id:branchId,
      p_actor:scope.session.user_id,p_sku:sku,p_quantity_delta:delta,
      p_note:note,p_request_id:body!.request_id,p_source:"pos"
    });
    if(error) {
      const code=String(error.message??"").match(/OPTICAL_[A-Z_]+/)?.[0]??"optical_stock_transaction_failed";
      const status=code==="OPTICAL_STOCK_INSUFFICIENT_UNRESERVED" || code==="OPTICAL_STOCK_IDEMPOTENCY_CONFLICT"?409:
        code==="OPTICAL_STOCK_SKU_UNKNOWN_OR_AMBIGUOUS"?404:
        code==="optical_stock_transaction_failed"?503:422;
      return fail(code,status===503?"ยังไม่สามารถบันทึกสต๊อกได้ กรุณาติดต่อ IT":code,status);
    }
    return NextResponse.json({data:Array.isArray(data)?data[0]:data,error:null});
  } catch(error) {
    if (error instanceof FeatureGateError || error instanceof PosGuardError)
      return fail(error.code,error.message,error.status);
    console.error("[optical-stock-adjust]",error);
    return fail("optical_stock_failed","ระบบปรับสต๊อกยังไม่พร้อม กรุณาติดต่อ IT",503);
  }
}
