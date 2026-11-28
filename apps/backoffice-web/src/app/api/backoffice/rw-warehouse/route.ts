import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { requirePosApiFeature, featureGateFail } from "@/lib/pos-api-feature-guard";
import { PosGuardError } from "@/lib/pos-session-guard";
import { getCustomPosStockUiMode } from "@/lib/server/custom-stock-ui-policy";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import { validateManagerPin } from "@/lib/pin-approval";
import { rwWarehouseUatAllowed } from "@/lib/retail-wholesale/warehouse-uat-policy";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";
class WarehouseError extends Error {
  constructor(public code: string, public status = 422) { super(code); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(v: unknown): string {
  if (typeof v !== "string" || !UUID.test(v)) throw new WarehouseError("INVALID_ID");
  return v;
}
function clean(v: unknown, max: number): string {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max) throw new WarehouseError("INVALID_FIELD");
  return v.trim();
}
function integer(v: unknown, min=1): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > 99999999999999)
    throw new WarehouseError("INVALID_QUANTITY");
  return v;
}
function dbResult(error: {code?:string;message?:string}|null) {
  if (!error) return;
  if (error.code === "23505") throw new WarehouseError("DUPLICATE_RECORD",409);
  const code=error.message?.split("\n")[0] ?? "";
  if (/^[A-Z_]{3,70}$/.test(code)) throw new WarehouseError(code,409);
  throw new WarehouseError("WAREHOUSE_DATABASE_UNAVAILABLE",503);
}
function nonCache(response:Response) {
  response.headers.set("Cache-Control","private, no-store, max-age=0");
  return response;
}
function responseError(error: unknown) {
  if (error instanceof WarehouseError) return nonCache(fail(error.code,error.code,error.status));
  if (error instanceof PosGuardError) return nonCache(fail(error.code,"POS access denied.",error.status));
  const feature=featureGateFail(error);
  if (feature) return nonCache(feature);
  return nonCache(fail("WAREHOUSE_UNAVAILABLE","Warehouse service unavailable.",503));
}
async function scope() {
  const auth=await getPosApiAuthContext({requiredPermission:"inventory:view"});
  if (!auth.tenantId || !auth.branchId || !rwWarehouseUatAllowed(auth.tenantId,{
    VERCEL_ENV:process.env.VERCEL_ENV,
    RW_WAREHOUSE_UAT_ENABLED:process.env.RW_WAREHOUSE_UAT_ENABLED,
    RW_WAREHOUSE_UAT_TENANT_ID:process.env.RW_WAREHOUSE_UAT_TENANT_ID
  })) throw new WarehouseError("WAREHOUSE_UAT_DISABLED",503);
  await requirePosApiFeature(auth,"stock_management");
  if (await getCustomPosStockUiMode(auth.tenantId)!=="retail_wholesale") throw new WarehouseError("RW_REQUIRED",403);
  const db=getSupabaseServiceClient();
  const membership=await db.from("user_branch_roles").select("role")
    .eq("tenant_id",auth.tenantId).eq("branch_id",auth.branchId).eq("user_id",auth.userId).in("role",["owner","manager"]);
  dbResult(membership.error);
  const owner=auth.branchRole==="owner" && (membership.data??[]).some(row=>row.role==="owner");
  const manager=auth.branchRole==="manager" && (membership.data??[]).some(row=>row.role==="manager");
  if(!owner&&!manager)throw new WarehouseError("FORBIDDEN_BRANCH",403);
  return {db,tenant:auth.tenantId,branch:auth.branchId,actor:auth.userId,owner};
}
export async function GET() {
  try {
    const {db,tenant,branch,owner}=await scope();
    let transferQuery=db.from("rw_warehouse_transfers").select("id,warehouse_id,destination_branch_id,status,created_at,rw_warehouse_transfer_lines(sku,quantity,received)").eq("tenant_id",tenant);
    if(!owner)transferQuery=transferQuery.eq("destination_branch_id",branch);
    const transfers=await transferQuery.order("created_at",{ascending:false}).limit(100);
    dbResult(transfers.error);
    if(!owner)return nonCache(ok({owner,warehouses:[],balances:[],branches:[],transfers:transfers.data??[]}));
    const [warehouses,balances,branches]=await Promise.all([
      db.from("rw_warehouses").select("id,code,name").eq("tenant_id",tenant).eq("active",true).order("code").limit(100),
      db.from("rw_warehouse_balances").select("warehouse_id,sku,quantity,carrying_minor").eq("tenant_id",tenant).order("sku").limit(500),
      db.from("branches").select("id,name").eq("tenant_id",tenant).eq("is_active",true).order("name").limit(100)
    ]);
    dbResult(warehouses.error);dbResult(balances.error);dbResult(branches.error);
    return nonCache(ok({owner,warehouses:warehouses.data??[],balances:balances.data??[],branches:branches.data??[],transfers:transfers.data??[]}));
  } catch(error) { return responseError(error); }
}
export async function POST(req:Request) {
  try {
    if(req.headers.get("origin")!==new URL(req.url).origin || !req.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
      throw new WarehouseError("ORIGIN_FORBIDDEN",403);
    const body=await req.json().catch(()=>null) as Record<string,unknown>|null;
    if(!body||typeof body!=="object"||Array.isArray(body)) throw new WarehouseError("INVALID_COMMAND");
    const {db,tenant,branch,actor,owner}=await scope();
    const action=body.action;
    if(action!=="receive"&&!owner) throw new WarehouseError("FORBIDDEN_WAREHOUSE",403);
    const request=uuid(body.requestId);
    const common={p_tenant:tenant,p_actor:actor,p_request:request};
    let fn:string;
    let params:Record<string,unknown>;
    switch(action) {
      case "create_warehouse": {
        const result=await db.from("rw_warehouses").insert({tenant_id:tenant,id:request,code:clean(body.code,40),name:clean(body.name,120)}).select("id").single();
        dbResult(result.error);return nonCache(ok(result.data,201));
      }
      case "register_sku": {
        const warehouse=uuid(body.warehouseId);
        const exists=await db.from("rw_warehouses").select("id").eq("tenant_id",tenant).eq("id",warehouse).eq("active",true).maybeSingle();
        dbResult(exists.error);if(!exists.data)throw new WarehouseError("WAREHOUSE_NOT_FOUND",404);
        const result=await db.from("rw_warehouse_balances").insert({tenant_id:tenant,warehouse_id:warehouse,sku:clean(body.sku,40)}).select("sku").single();
        dbResult(result.error);return nonCache(ok(result.data,201));
      }
      case "inbound":
        // UAT-only receipt reference. Production requires verified purchasing document lines.
        fn="rw_inbound_candidate";params={...common,p_warehouse:uuid(body.warehouseId),p_sku:clean(body.sku,40),
          p_quantity:integer(body.quantity),p_total_minor:integer(body.totalMinor,0),p_source_document:clean(body.sourceDocument,120)};break;
      case "create_draft": {
        if(!Array.isArray(body.lines)||body.lines.length<1||body.lines.length>100) throw new WarehouseError("INVALID_LINES");
        const lines=body.lines.map((line:unknown)=>{
          if(!line||typeof line!=="object"||Array.isArray(line))throw new WarehouseError("INVALID_LINE");
          const row=line as Record<string,unknown>;
          return {sku:clean(row.sku,40),quantity:integer(row.quantity)};
        });
        fn="rw_create_draft_candidate";params={...common,p_warehouse:uuid(body.warehouseId),p_branch:uuid(body.branchId),p_lines:lines};break;
      }
      case "approve_transfer":
      case "cancel_transfer": {
        // Reuse existing PIN verifier, never a browser-supplied approver or approval flag.
        const pin=clean(body.pin,64);
        const verified=await validateManagerPin("stock_adjustment",pin,{tenantId:tenant,branchId:branch});
        if(!verified.approved||verified.approverRole!=="owner"||!verified.approverUserId)throw new WarehouseError("PIN_REJECTED",403);
        fn="rw_apply_transfer_pin_candidate";params={...common,p_transfer:uuid(body.transferId),p_approver:verified.approverUserId,p_action:action};break;
      }
      case "dispatch":
        fn="rw_dispatch_candidate";params={...common,p_transfer:uuid(body.transferId)};break;
      case "receive": {
        const transfer=uuid(body.transferId);
        const check=await db.from("rw_warehouse_transfers").select("id").eq("tenant_id",tenant).eq("id",transfer).eq("destination_branch_id",branch).maybeSingle();
        dbResult(check.error);if(!check.data)throw new WarehouseError("TRANSFER_NOT_FOUND",404);
        fn="rw_receive_candidate";params={...common,p_transfer:transfer,p_sku:clean(body.sku,40),p_quantity:integer(body.quantity)};break;
      }
      default:throw new WarehouseError("INVALID_COMMAND");
    }
    const result=await db.rpc(fn,params);
    dbResult(result.error);
    return nonCache(ok(result.data));
  } catch(error) { return responseError(error); }
}
