import { createHash } from "node:crypto";
import { getPosApiAuthContext } from "@/lib/pos-api-auth";
import { featureGateFail, requirePosApiFeature } from "@/lib/pos-api-feature-guard";
import { authorizeOpticalMoreMenu } from "@/lib/server/optical-more-feature-access";
import { requirePosSession, PosGuardError } from "@/lib/pos-session-guard";
import { fail, ok } from "@/lib/http";
import { loadPosSalesSummaryData, type PosSalesSummaryFilters } from "@/lib/services/pos-sales-summary-service";
import { renderSalesPrintHtml, type SalesPrintKind, type SalesPrintLanguage } from "@/lib/printing/sales-summary-report-html";
import { queueRoutedSalesSummaryReport } from "@/lib/printing/routed-print-service";

export const runtime = "nodejs";
const KINDS = new Set<SalesPrintKind>(["summary","payments","products","cashiers","sales","sale_row","shift_row"]);
type Body = {
  mode?: "preview" | "queue";
  kind?: string;
  paperWidthMm?: number;
  language?: string;
  rowId?: string | null;
  requestId?: string;
  previewHash?: string;
  filters?: PosSalesSummaryFilters;
};

function validDay(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const ms = Date.parse(day+"T00:00:00Z");
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0,10)===day;
}
function validateFilters(value: PosSalesSummaryFilters) {
  const from = String(value.dateFrom ?? "");
  const to = String(value.dateTo ?? "");
  if (!validDay(from) || !validDay(to)) throw new Error("sales_print_invalid_dates");
  const days = (Date.parse(to+"T00:00:00Z")-Date.parse(from+"T00:00:00Z"))/86_400_000;
  if (days<0 || days>365) throw new Error("sales_print_range_exceeds_year");
  return { ...value, dateFrom: from, dateTo: to };
}

export async function POST(req: Request) {
  try {
    const origin = req.headers.get("origin");
    if (origin && new URL(origin).host !== new URL(req.url).host) {
      return fail("sales_print_invalid_origin","Cross-site printing is not permitted.",403);
    }
    const input = await req.json().catch(() => null) as Body | null;
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return fail("sales_print_invalid_request","Report request must be JSON.",422);
    }
    const mode = input.mode;
    const kind = input.kind as SalesPrintKind;
    const paper = input.paperWidthMm;
    const language = (input.language === "en" || input.language === "lo" ? input.language : "th") as SalesPrintLanguage;
    if ((mode !== "preview" && mode !== "queue") || !KINDS.has(kind) || (paper !== 58 && paper !== 80)) {
      return fail("sales_print_invalid_selection","Choose a report and a 58mm or 80mm paper size.",422);
    }
    const filters = validateFilters(input.filters ?? {});
    const auth = await getPosApiAuthContext({requireBranchScope:true,requiredPermission:"reports:view"});
    if (!await authorizeOpticalMoreMenu(auth.tenantId!,auth.branchId,"more.sales_summary")) {
      await requirePosApiFeature(auth,"advanced_sales_reports");
    }
    const payload = await loadPosSalesSummaryData({
      userId: auth.userId,
      tenantId: auth.tenantId,
      branchId: auth.branchId,
      branchRole: auth.branchRole,
      platformRole: auth.platformRole
    },filters,{fullYearReport:true});
    // A dishonest 365-day report is worse than an explicit unavailable message:
    // the data service rejects >1200 orders rather than silently clipping totals.
    if (!payload.salesRows.length && !payload.shifts.length) return fail("sales_print_no_data","No authorized sales in this period.",422);
    const rowId = typeof input.rowId === "string" && input.rowId.length <= 80 ? input.rowId : null;
    const render = (width:58|80) => renderSalesPrintHtml({payload,kind,paperWidthMm:width,language,rowId});
    const preview = render(paper);
    const currentHash = createHash("sha256").update(preview.html).digest("hex");
    if (mode === "preview") {
      return ok({html:preview.html,title:preview.title,paperWidthMm:paper,previewHash:currentHash,
        period:{dateFrom:payload.filters.dateFrom,dateTo:payload.filters.dateTo},
        currencyCode:payload.currencyCode});
    }
    if (input.previewHash !== currentHash) {
      return fail("sales_print_preview_stale","Sales report changed since preview. Refresh the preview before confirming print.",409);
    }
    // Do not accept HTML, amounts, tenant IDs or authorization scopes from the
    // client. Re-render the full report from current, server-authorized records.
    const requestId = String(input.requestId ?? "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      return fail("sales_print_invalid_request_id","A unique confirmation request ID is required.",422);
    }
    const session = await requirePosSession();
    const jobs = await queueRoutedSalesSummaryReport({
      auth, runtimeDeviceCode: session.session.device_code,
      requestId, kind, requestedPaperWidth: paper,
      buildForPaper: width => render(width).html
    });
    if (!jobs.length) {
      return fail("sales_print_printer_not_configured","No Android-compatible report/receipt printer is assigned to this POS device.",422);
    }
    return ok({queued:true,jobs:jobs.map(job=>({id:job.id,status:job.status}))});
  } catch(error) {
    if(error instanceof PosGuardError) return fail(error.code,error.message,error.status);
    const feature = featureGateFail(error);
    if(feature) return feature;
    const code = error instanceof Error ? error.message : "sales_print_failed";
    if (code==="sales_report_too_many_orders_narrow_period" || code==="sales_print_too_many_rows_narrow_period") {
      return fail(code,"Too many sales to print accurately in one job. Choose a shorter period; no partial report was printed.",422);
    }
    if (code==="sales_print_invalid_dates" || code==="sales_print_range_exceeds_year"
        || code==="sales_print_row_not_in_authorized_scope" || code==="sales_print_document_too_large"
        || code==="report_print_device_session_required" || code==="sales_print_paper_width_mismatch") {
      return fail(code,code,422);
    }
    return fail("sales_print_failed","Unable to prepare authorized sales report.",500);
  }
}
