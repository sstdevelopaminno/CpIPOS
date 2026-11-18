import { fail, ok } from "@/lib/http";
import { requireFinanceSession } from "@/lib/server/finance-session";
import { getTenantPosMenuOverrides } from "@/lib/server/pos-menu-policy-service";
import { isAccountantMenuVisible } from "@/lib/accountant-menu-policy";
import { loadFinanceSalesReport } from "@/lib/server/finance-sales-report-service";
import {
  FinanceDocumentError, loadFinanceDocument, loadAccountantTaxProfiles,
  appendFinanceReceiptCorrection, issueAccountantTaxInvoice, createAccountantTaxBuyer,
  type ReceiptEditInput
} from "@/lib/server/finance-document-service";
import { todayBangkok } from "@/lib/finance-sales-analytics";

export const dynamic = "force-dynamic";

function defaultFrom() {
  const [year, month, day] = todayBangkok().split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - 6 * 86_400_000).toISOString().slice(0, 10);
}
async function authorized(menuKey: string) {
  const identity = await requireFinanceSession();
  if (!identity) throw new FinanceDocumentError("finance_session_required", 401);
  const overrides = await getTenantPosMenuOverrides(identity.tenantId);
  if (!isAccountantMenuVisible(menuKey, overrides))
    throw new FinanceDocumentError("finance_menu_disabled", 403);
  return identity;
}
function handleError(error: unknown) {
  if (error instanceof FinanceDocumentError) return fail(error.code, error.code, error.status);
  const reason = error instanceof Error ? error.message : "finance_document_error";
  if (reason.startsWith("finance_")) return fail(reason, reason, 422);
  console.error("[finance/documents]", reason);
  return fail("finance_documents_unavailable", "ไม่สามารถดำเนินการเอกสารได้", 503);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("mode") ?? "list";
  try {
    const kind = url.searchParams.get("kind");
    const identity = await authorized(mode === "buyers" || kind === "tax" ? "finance.tax_reports" : "finance.sales_receivables");
    if (mode === "detail") {
      const orderId = url.searchParams.get("orderId") ?? "";
      return ok(await loadFinanceDocument(identity, orderId));
    }
    if (mode === "buyers") {
      return ok({ buyers: await loadAccountantTaxProfiles(identity, url.searchParams.get("branchId") ?? "") });
    }
    if (mode !== "list") return fail("finance_document_mode_invalid", "Invalid document mode", 422);
    const report = await loadFinanceSalesReport({
      actor: "accountant", tenantId: identity.tenantId,
      userId: identity.userId, branchIds: identity.branchIds
    }, {
      from: url.searchParams.get("from") ?? defaultFrom(),
      to: url.searchParams.get("to") ?? todayBangkok(),
      branchId: url.searchParams.get("branchId"),
      billNo: url.searchParams.get("billNo"), method: "all", reconciliation: "all",
      page: url.searchParams.get("page"), pageSize: "20"
    });
    const response = ok({ table: report.table, range: report.range, branches: report.branches });
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    return response;
  } catch (error) { return handleError(error); }
}

export async function POST(request: Request) {
  try {
    // Finance cookie is SameSite=Lax, and document mutations additionally require same-origin JSON.
    if (request.headers.get("origin") !== new URL(request.url).origin ||
        !request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
      return fail("finance_origin_forbidden", "Same-origin JSON request required", 403);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const action = body?.action;
    if (action === "correct" || action === "void") {
      const identity = await authorized("finance.sales_receivables");
      const data = await appendFinanceReceiptCorrection(identity, {
        orderId: String(body?.orderId ?? ""),
        action, reason: String(body?.reason ?? ""),
        expectedRevision: Number(body?.expectedRevision),
        documentDate: typeof body?.documentDate === "string" ? body.documentDate : undefined,
        customerName: typeof body?.customerName === "string" ? body.customerName : undefined,
        note: typeof body?.note === "string" ? body.note : undefined,
        items: Array.isArray(body?.items) ? body.items as ReceiptEditInput["items"] : undefined,
        discountAmount: body?.discountAmount as number | undefined,
        taxAmount: body?.taxAmount as number | undefined,
        totalAmount: body?.totalAmount as number | undefined
      }, request);
      return ok(data);
    }
    if (action === "create_buyer") {
      const identity = await authorized("finance.tax_reports");
      const profile = body?.profile as Record<string, unknown> | null | undefined;
      if (!profile) return fail("finance_tax_buyer_invalid", "Buyer details required", 422);
      return ok(await createAccountantTaxBuyer(identity, {
        branchId: String(profile.branchId ?? ""), entityType: String(profile.entityType ?? ""),
        displayName: String(profile.displayName ?? ""), taxId: String(profile.taxId ?? ""),
        addressLine: String(profile.addressLine ?? ""), postalCode: String(profile.postalCode ?? ""),
        subdistrict: String(profile.subdistrict ?? ""), district: String(profile.district ?? ""),
        province: String(profile.province ?? "")
      }));
    }
    if (action === "issue_tax") {
      const identity = await authorized("finance.tax_reports");
      return ok(await issueAccountantTaxInvoice(
        identity, String(body?.orderId ?? ""), String(body?.buyerId ?? "")
      ));
    }
    return fail("finance_document_action_invalid", "Invalid document action", 422);
  } catch (error) { return handleError(error); }
}
