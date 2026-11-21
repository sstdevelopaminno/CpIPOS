import { fail, ok } from "@/lib/http";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { requirePosSession, PosGuardError } from "@/lib/pos-session-guard";
import { requirePosApiFeature, featureGateFail } from "@/lib/pos-api-feature-guard";
import { assertPosMenuPageAllowed } from "@/lib/server/pos-menu-policy-service";
import { isAuthorizedRecyclingTenant } from "@/lib/server/recycling-pos-service";
import { loadRecyclingHistoryReport, type RecyclingReportQuery } from "@/lib/server/recycling-history-reports";
import { queueRoutedRecyclingReport } from "@/lib/printing/recycling-report-print-service";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request:Request){
 try{
  const origin=request.headers.get("origin");
  if(origin && new URL(origin).host!==new URL(request.url).host) return fail("recycling_report_invalid_origin","Cross-site printing forbidden.",403);
  const body=await request.json().catch(()=>null) as {request_id?:string;filters?:RecyclingReportQuery}|null;
  if(!body||typeof body.request_id!=="string"||!UUID.test(body.request_id))return fail("recycling_report_invalid_request","Print request UUID required.",422);
  const scope=await requirePosSession();
  const tenantId=scope.session.tenant_id;
  await assertPosMenuPageAllowed(tenantId,"/preview/pos/sales-summary");
  if(!await isAuthorizedRecyclingTenant(tenantId))return fail("recycling_report_forbidden","Recycling access required.",403);
  const auth=await getPosApiAuthContext({requireBranchScope:true,requiredPermission:"reports:view"});
  await requirePosApiFeature(auth,"advanced_sales_reports");
  const report=await loadRecyclingHistoryReport(scope,"summary",body.filters??{});
  const jobs=await queueRoutedRecyclingReport({
   auth,deviceCode:scope.session.device_code,report,requestId:body.request_id
  });
  if(!jobs.length)return fail("recycling_report_printer_not_configured","No receipt/report printer assigned to this device.",422);
  return ok({queued:true,jobs});
 }catch(error){
  if(error instanceof PosGuardError)return fail(error.code,error.message,error.status);
  const feature=featureGateFail(error);if(feature)return feature;
  const code=error instanceof Error?error.message:"recycling_report_print_failed";
  if(code==="recycling_report_narrow_period_required"||code==="recycling_report_invalid_date_range"||
    code==="recycling_report_branch_denied")return fail(code,code,422);
  console.error("[recycling-report-print]",{code:code.slice(0,90)});
  return fail("recycling_report_print_failed","Unable to prepare or queue Recycling report.",500);
 }
}
