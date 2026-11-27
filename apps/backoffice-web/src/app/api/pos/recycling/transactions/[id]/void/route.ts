import { fail, ok } from "@/lib/http";
import { FeatureGateError } from "@/lib/feature-gate";
import { PosGuardError, requirePosSession, requirePermission } from "@/lib/pos-session-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Supervised VOID does NOT delete the receipt or posted source subledger.
 * The DB refuses closed shifts, missing stock provenance, posted GL,
 * bank transfer reversal and self-approval. Same-shift only.
 */
export async function POST(request: Request,{
  params
}: { params: Promise<{id:string}> }) {
  try {
    const { id }=await params;
    if (!UUID.test(id)) return fail("recycling_void_id_invalid","A valid transaction is required.",422);
    const scope=await requirePosSession();
    requirePermission(scope,"sales:list:view");
    const origin=request.headers.get("origin");
    if(origin&&origin!==new URL(request.url).origin)return fail("recycling_void_origin_invalid","ไม่อนุญาตคำขอจากเว็บไซต์อื่น",403);
    if (!["owner","manager","accountant"].includes(scope.session.role)) {
      return fail("recycling_void_approver_forbidden","เฉพาะผู้ใช้ที่มีสิทธิ์ยกเลิกบิล",403);
    }
    if (!await isAuthorizedRecyclingTenant(scope.session.tenant_id)) {
      return fail("recycling_not_authorized","An active CUSTOM Recycling entitlement is required.",403);
    }
    if (process.env.RECYCLING_STOCK_SCHEMA_READY!=="1" ||
        process.env.RECYCLING_TRANSACTION_WRITES_ENABLED!=="1" ||
        process.env.RECYCLING_VOID_ENABLED!=="1") {
      return fail("recycling_void_uat_only","Voiding remains disabled until verified finance and stock UAT.",503);
    }
    const raw=await request.json().catch(()=>null) as Record<string,unknown>|null;
    const requestId=typeof raw?.request_id==="string"?raw.request_id:"";
    const reason=typeof raw?.reason==="string"?raw.reason.trim():"";
    if (!UUID.test(requestId) || reason.length<10 || reason.length>500 ||
        raw?.stock_verified!==true ||
        typeof raw?.cash_returned_confirmed!=="boolean") {
      return fail("recycling_void_invalid_confirmation",
        "Enter a detailed reason, verify physical stock and acknowledge cash refund/return.",422);
    }
    const db=getSupabaseServiceClient();
    const { data,error }=await db.rpc("recycling_void_unposted_transaction",{
      p_tenant_id:scope.session.tenant_id,
      p_branch_id:scope.session.branch_id,
      p_transaction_id:id,
      p_approver_user_id:scope.session.user_id,
      p_void_request_id:requestId,
      p_reason:reason,
      p_stock_verified:true,
      p_cash_returned_confirmed:raw.cash_returned_confirmed
    });
    if (error) {
      if (error.code==="PGRST202" || error.code==="42883") {
        return fail("recycling_void_migration_required",
          "The approved reversal migration is not installed.",503);
      }
      const codes=[
        "recycling_void_already_voided","recycling_void_shift_already_closed",
        "recycling_void_finance_already_posted","recycling_void_bank_reversal_requires_finance",
        "recycling_void_cash_confirmation_required","recycling_void_self_approval_forbidden",
        "recycling_void_material_has_later_movement","recycling_void_historical_replay_required","recycling_void_approver_forbidden",
        "recycling_void_cash_drawer_insufficient","recycling_void_original_missing"
      ];
      const code=codes.find(x=>error.message.includes(x));
      if (code) return fail(code,code,409);
      console.error("[recycling void] denied",{code:error.code});
      return fail("recycling_void_failed","Could not safely void transaction. No confirmation has been recorded.",500);
    }
    return ok({ voided:data });
  } catch(error) {
    if (error instanceof PosGuardError || error instanceof FeatureGateError) {
      return fail(error.code,error.message,error.status);
    }
    return fail("recycling_void_failed","Could not void transaction.",500);
  }
}
