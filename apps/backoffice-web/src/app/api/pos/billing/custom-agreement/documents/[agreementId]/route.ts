import { PosGuardError, requirePosSessionForNonSaleRecovery } from "@/lib/pos-session-guard";
import { fail } from "@/lib/http";
import { renderActiveCustomAgreement } from "@/lib/printing/custom-agreement-document";
export const dynamic="force-dynamic";
export const runtime="nodejs";
type Params={params:Promise<{agreementId:string}>};
export async function GET(_request:Request,{params}:Params){
  try{
    const scope=await requirePosSessionForNonSaleRecovery();
    if(scope.session.role!=="owner")return fail("owner_required","เฉพาะเจ้าของร้าน",403);
    const {agreementId}=await params;
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(agreementId))return fail("agreement_invalid","Invalid agreement",422);
    return await renderActiveCustomAgreement(scope.session.tenant_id,agreementId);
  }catch(e){if(e instanceof PosGuardError)return fail(e.code,e.message,e.status);return fail("agreement_unavailable","Agreement unavailable",503);}
}
