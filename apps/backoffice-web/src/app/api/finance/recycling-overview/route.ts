import {fail,ok} from "@/lib/http";
import {requireFinanceReadScope,FinanceReportError} from "@/lib/server/finance-report-guard";
import {isAuthorizedRecyclingTenant} from "@/lib/server/recycling-pos-service";
import {loadRecyclingFinanceOverview} from "@/lib/server/recycling-finance-overview-service";
import {todayBangkok} from "@/lib/finance-sales-analytics";
import {PosGuardError} from "@/lib/pos-session-guard";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 const params=new URL(request.url).searchParams;
 const actor=params.get("actor");
 if(actor!=="owner"&&actor!=="accountant")return fail("finance_actor_required","ไม่พบสิทธิ์การเงิน",400);
 try{
  const scope=await requireFinanceReadScope(actor);
  if(!await isAuthorizedRecyclingTenant(scope.tenantId))return fail("recycling_not_authorized","ไม่รองรับโหมดค้าของเก่า",403);
  const today=todayBangkok();
  const report=await loadRecyclingFinanceOverview(scope,params.get("from")??today,params.get("to")??today,params.get("branchId")||null);
  const response=ok(report);response.headers.set("Cache-Control","private, no-store, max-age=0");return response;
 }catch(error){
  if(error instanceof FinanceReportError||error instanceof PosGuardError)return fail(error.code,error.code==="recycling_finance_narrow_dates"?"ข้อมูลเกินขอบเขตรายงาน กรุณาเลือกช่วงวันที่สั้นลง":"ไม่สามารถโหลดรายงานตามสิทธิ์หรือช่วงวันที่นี้ได้",error.status);
  return fail("recycling_finance_unavailable","ยังไม่สามารถยืนยันยอดการเงินได้",503);
 }
}
