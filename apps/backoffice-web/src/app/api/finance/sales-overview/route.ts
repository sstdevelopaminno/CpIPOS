import { fail, ok } from "@/lib/http";
import { PosGuardError } from "@/lib/pos-session-guard";
import { requireFinanceReadScope, FinanceReportError, type FinanceReportActor } from "@/lib/server/finance-report-guard";
import { loadFinanceSalesReport } from "@/lib/server/finance-sales-report-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const actor = url.searchParams.get("actor");
  if (actor !== "owner" && actor !== "accountant")
    return fail("finance_actor_required", "Specify an authenticated Finance actor.", 400);
  try {
    const scope = await requireFinanceReadScope(actor as FinanceReportActor);
    const report = await loadFinanceSalesReport(scope, {
      from: url.searchParams.get("from"),
      to: url.searchParams.get("to"),
      branchId: url.searchParams.get("branchId")
    });
    const response = ok(report);
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  } catch (error) {
    if (error instanceof FinanceReportError)
      return fail(error.code, error.code, error.status);
    if (error instanceof PosGuardError)
      return fail(error.code, "Finance authorization denied.", error.status);
    console.error("[finance/sales-overview] unavailable", error instanceof Error ? error.message : "unknown");
    return fail("finance_report_unavailable", "ไม่สามารถอ่านรายงานการเงินได้ชั่วคราว", 503);
  }
}
