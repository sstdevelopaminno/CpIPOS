import { fail, ok } from "@/lib/http";
import { requirePermission, requirePosSession } from "@/lib/pos-session-guard";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

import { recyclingVatBlockers,validVatRule } from "@/lib/recycling-vat-readiness";

export const dynamic="force-dynamic";

export async function GET(){
  try{
    const scope=await requirePosSession();
    requirePermission(scope,"sale:create");
    if(!await isAuthorizedRecyclingTenant(scope.session.tenant_id))
      return fail("recycling_not_authorized","ไม่มีสิทธิ์ใช้โหมด Recycling",403);
    const {tenant_id:tenantId,branch_id:branchId}=scope.session;
    const db=getSupabaseServiceClient();
    const [settings,issuer,account]=await Promise.all([
      db.from("tenant_tax_settings")
        .select("is_enabled,settings").eq("tenant_id",tenantId)
        .eq("branch_id",branchId).maybeSingle(),
      db.from("recycling_vat_issuers")
        .select("active,verified_at,verified_from,verified_until")
        .eq("tenant_id",tenantId).eq("branch_id",branchId).maybeSingle(),
      db.from("finance_accounting_chart")
        .select("account_code").eq("tenant_id",tenantId)
        .eq("account_code","2200").eq("account_type","liability").maybeSingle()
    ]);
    if(settings.error)return fail("recycling_vat_settings_unavailable",
      "ไม่สามารถอ่านการตั้งค่า VAT ของสาขา",503);
    // A schema missing during phased rollout must not be treated as a verified
    // VAT issuer or an invitation to charge tax.
    if(issuer.error||account.error)return ok({
      configured:Boolean(settings.data?.is_enabled),rollout_enabled:false,
      ready:false,rate_pct:0,mode:"none",reason:"recycling_vat_schema_not_ready",
      blockers:["recycling_vat_schema_not_ready"]
    });
    const configured=settings.data?.is_enabled===true;
    const ruleValid=validVatRule(settings.data?.settings);
    const issuerData=issuer.data;
    const today=new Intl.DateTimeFormat("en-CA",{
      timeZone:"Asia/Bangkok",year:"numeric",month:"2-digit",day:"2-digit"
    }).format(new Date());
    const verified=Boolean(issuerData?.active&&issuerData.verified_at&&
      issuerData.verified_from<=today&&
      (!issuerData.verified_until||issuerData.verified_until>=today));
    // The VAT RPC is installed; branch settings and verified Finance readiness govern use.
    const rollout=true;
    const blockers=recyclingVatBlockers({configured,rollout,ruleValid,verified,accountReady:!!account.data});
    const ready=blockers.length===0;
    const reason=blockers[0]??null;
    return ok({configured,rollout_enabled:rollout,ready,
      rate_pct:configured&&ruleValid?7:0,mode:configured&&ruleValid?"add_to_bill":"none",
      reason,blockers});
  }catch{
    return fail("recycling_vat_quote_unavailable","ไม่สามารถตรวจสอบ VAT ได้",503);
  }
}
