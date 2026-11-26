import {fail} from "@/lib/http";
import {requirePosSession,requirePermission,PosGuardError} from "@/lib/pos-session-guard";
import {recyclingAmountCorrection} from "@/lib/server/recycling-amount-correction-service";
async function handle(request:Request,{params}:{params:Promise<{id:string}>}){
 try{
  const scope=await requirePosSession();
  requirePermission(scope,"sales:list:view");
  if(!["owner","manager"].includes(scope.session.role))return fail("recycling_correction_forbidden","เฉพาะเจ้าของหรือผู้จัดการที่ได้รับสิทธิ์",403);
  return await recyclingAmountCorrection(request,(await params).id,{tenantId:scope.session.tenant_id,branchId:scope.session.branch_id,userId:scope.session.user_id,source:"pos"});
 }catch(e){if(e instanceof PosGuardError)return fail(e.code,e.message,e.status);return fail("recycling_correction_failed","ไม่สามารถแก้ไขเอกสารได้",503);}
}

export const GET=handle;
export const POST=handle;
