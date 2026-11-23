import type { AuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import { PosGuardError, requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { queueRoutedRecyclingShiftOpenSlip } from "@/lib/printing/recycling-shift-open-print-service";

function normalizeRole(role:string):AuthContext["branchRole"] {
 return role==="owner"||role==="manager"||role==="accountant"||role==="staff"
  ? role : "staff";
}

/** Called only after the existing shift/open endpoint confirms a persisted shift.
 * Never creates/opens a shift or changes the drawer amount. */
export async function POST(request:Request,context:{params:Promise<{shiftId:string}>}){
 try{
  const origin=request.headers.get("origin");
  if(origin&&new URL(origin).origin!==new URL(request.url).origin)
   return fail("recycling_shift_print_invalid_origin","Cross-site print request forbidden",403);
  const scope=await requirePosSession();
  requirePermission(scope,"shift:join");
  if(!await isAuthorizedRecyclingTenant(scope.session.tenant_id))
   return fail("recycling_shift_print_forbidden","CUSTOM Recycling required",403);
  const {shiftId}=await context.params;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(shiftId))
   return fail("recycling_shift_print_invalid_id","Invalid shift ID",422);
  const auth:AuthContext={
   tenantId:scope.session.tenant_id,
   branchId:scope.session.branch_id,
   userId:scope.session.user_id,
   branchRole:normalizeRole(scope.session.role),
   platformRole:"tenant_user"
  };
  const jobs=await queueRoutedRecyclingShiftOpenSlip({
   auth,shiftId,runtimeDeviceCode:scope.session.device_code
  });
  return ok({queued:jobs.length>0,skipped:jobs.length===0,
   jobs:jobs.map(job=>({
    id:job.id,status:job.status,fast_wake:job.fast_wake===true
   }))});
 }catch(error){
  if(error instanceof PosGuardError)return fail(error.code,error.message,error.status);
  const code=error instanceof Error?error.message:"recycling_shift_open_print_failed";
  if(code==="recycling_shift_open_print_not_authorized")
   return fail(code,"Shift is not an open Recycling shift on this POS device",409);
  console.warn("[recycling-shift-open-print]",{code:code.slice(0,96)});
  return fail("recycling_shift_open_print_failed","Unable to queue the shift-opening slip",503);
 }
}
