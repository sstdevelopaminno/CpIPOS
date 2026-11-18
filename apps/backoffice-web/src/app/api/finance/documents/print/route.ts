import { requireFinanceSession } from "@/lib/server/finance-session";
import { getTenantPosMenuOverrides } from "@/lib/server/pos-menu-policy-service";
import { isAccountantMenuVisible } from "@/lib/accountant-menu-policy";
import { FinanceDocumentError, loadFinanceDocument } from "@/lib/server/finance-document-service";
import { renderReceiptHtml } from "@/lib/printing/receipt-html-template";
import { buildTaxInvoicePrintHtml } from "@/lib/pos-tax-invoice";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const width: 58 | 80 = params.get("width") === "58" ? 58 : 80;
  if (kind !== "receipt" && kind !== "tax")
    return fail("finance_print_kind_invalid", "Choose receipt or tax.", 422);
  try {
    const identity = await requireFinanceSession();
    if (!identity) throw new FinanceDocumentError("finance_session_required", 401);
    const overrides = await getTenantPosMenuOverrides(identity.tenantId);
    if (!isAccountantMenuVisible(kind === "tax" ? "more.tax_invoices" : "more.receipts", overrides))
      throw new FinanceDocumentError("finance_menu_disabled", 403);
    const detail = await loadFinanceDocument(identity, params.get("orderId") ?? "");
    let html: string;
    if (kind === "tax") {
      const invoice = detail.invoice;
      if (!invoice || invoice.status !== "issued")
        throw new FinanceDocumentError("finance_tax_invoice_not_issued", 409);
      html = buildTaxInvoicePrintHtml({
        invoiceNo: invoice.invoiceNo, issuedAt: invoice.issuedAt,
        paperWidthMm: width, seller: invoice.seller, buyer: invoice.buyer,
        order: invoice.order, items: invoice.items, tax: invoice.tax
      });
    } else {
      const receipt = detail.receipt;
      if (receipt.voided) throw new FinanceDocumentError("finance_receipt_voided", 409);
      // This renders the immutable original or an explicitly versioned correction.
      // Underlying completed sale and payment timestamp are always preserved.
      const extra = receipt.revision
        ? `เอกสารฉบับแก้ไข #${receipt.revision} · ${receipt.correctionReason} · ต้นฉบับยอด ${receipt.originalTotal} · วันที่รับเงินจริง ${receipt.paidAt}. ไม่แก้รายการขาย POS`
        : `สำเนาใบเสร็จจากระบบ POS · วันที่รับเงินจริง ${receipt.paidAt}`;
      html = renderReceiptHtml({
        paperWidthMm: width, languageCode: "th",
        currencyCode: receipt.currency === "LAK" ? "LAK" : "THB",
        storeName: detail.store.name, branchName: receipt.branchName,
        storeAddress: detail.store.address, storePhone: detail.store.phone,
        logoUrl: null, sellerName: "ฝ่ายบัญชี",
        orderNo: receipt.orderNo + (receipt.revision ? "-REV" + receipt.revision : ""),
        paidAtIso: receipt.revision ? receipt.documentDate + "T12:00:00+07:00" : receipt.paidAt,
        items: receipt.items.map(item => ({
          name: item.name, quantity: item.quantity, unitPrice: item.unitPrice,
          lineTotal: item.lineTotal, note: item.note
        })),
        discountAmount: receipt.discountAmount, taxAmount: receipt.taxAmount,
        totalAmount: receipt.totalAmount, paymentMethod: receipt.paymentMethod,
        note: [receipt.customerName ? "ลูกค้า: " + receipt.customerName : "", receipt.note, extra].filter(Boolean).join(" | "),
        reprint: true
      });
    }
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: https:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
      }
    });
  } catch (error) {
    if (error instanceof FinanceDocumentError)
      return fail(error.code, error.code, error.status);
    console.error("[finance/documents/print]", error instanceof Error ? error.message : "unavailable");
    return fail("finance_print_unavailable", "Unable to render document", 503);
  }
}
