import type { AuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import { FeatureGateError } from "@/lib/feature-gate";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { queueRoutedRecyclingReceipt } from "@/lib/printing/recycling-receipt-print-service";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function permittedRole(role: string): AuthContext["branchRole"] {
  if (role==="owner" || role==="manager" || role==="staff" || role==="accountant") return role;
  return "staff";
}

export async function POST(request: Request,{
  params
}: { params: Promise<{ id: string }> }) {
  try {
    const { id }=await params;
    if (!UUID.test(id)) return fail("invalid_recycling_receipt_id","Valid receipt ID required.",422);
    const scope=await requirePosSession();
    requirePermission(scope,"shift:join");
    if (!["owner","manager","staff","accountant"].includes(scope.session.role)) {
      return fail("recycling_receipt_print_forbidden","This user may not print Recycler receipts.",403);
    }
    if (!await isAuthorizedRecyclingTenant(scope.session.tenant_id)) {
      return fail("recycling_not_authorized","Recycling entitlement is required.",403);
    }
    if (process.env.RECYCLING_STOCK_SCHEMA_READY!=="1") {
      return fail("recycling_migration_required","Recycling receipt backend not installed.",503);
    }
    const body=await request.json().catch(()=>null) as {request_id?: unknown}|null;
    if (!body || typeof body.request_id!=="string" || !UUID.test(body.request_id)) {
      return fail("invalid_print_request","A unique print request is required.",422);
    }
    const auth:AuthContext={
      userId:scope.session.user_id,
      tenantId:scope.session.tenant_id,
      branchId:scope.session.branch_id,
      branchRole:permittedRole(scope.session.role),
      platformRole:"tenant_user"
    };
    const jobs=await queueRoutedRecyclingReceipt({
      auth,
      runtimeDeviceCode:scope.session.device_code,
      transactionId:id,
      requestId:body.request_id
    });
    return ok({ queued:true,jobs });
  } catch (error) {
    if (error instanceof PosGuardError || error instanceof FeatureGateError) {
      return fail(error.code,error.message,error.status);
    }
    const code=error instanceof Error?error.message:"recycling_receipt_print_failed";
    if (code==="recycling_receipt_not_found") return fail(code,"Receipt not found in current branch.",404);
    if (code==="recycling_receipt_printer_not_configured") return fail(code,"No receipt printer configured for this POS device.",422);
    if (code==="recycling_receipt_total_mismatch") return fail(code,"Receipt amount does not match stored lines.",409);
    console.error("[recycling receipt print] failed",{type:code.slice(0,90)});
    return fail("recycling_receipt_print_failed","Could not queue receipt printing; use browser print or contact Support.",500);
  }
}
