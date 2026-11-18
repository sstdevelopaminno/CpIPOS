import "server-only";

import type { FinanceDocumentDetail } from "@/lib/server/finance-document-service";
import { renderOfficeDocumentHtml, type OfficePaperSize } from "./office-document-html";
export type { OfficePaperSize } from "./office-document-html";

/** Map verified, immutable Finance source documents to the shared office-sized layout. */
export function renderFinanceOfficeDocumentHtml(args: {
  detail: FinanceDocumentDetail;
  kind: "receipt" | "tax";
  paper: OfficePaperSize;
}): string {
  const { detail, kind, paper } = args;
  const receipt = detail.receipt;
  if (kind === "tax") {
    const tax = detail.invoice;
    if (!tax || tax.status !== "issued") throw new Error("finance_office_tax_not_issued");
    return renderOfficeDocumentHtml({
      paper, kind, number: tax.invoiceNo, issuedAt: tax.issuedAt,
      seller: { name: tax.seller.display_name, taxId: tax.seller.tax_id,
        address: tax.seller.address, phone: tax.seller.phone },
      buyer: { name: tax.buyer.display_name, taxId: tax.buyer.tax_id,
        address: [tax.buyer.address_line, tax.buyer.subdistrict,
          tax.buyer.district, tax.buyer.province, tax.buyer.postal_code].filter(Boolean).join(" ") },
      items: tax.items.map(item => ({ name: item.name, quantity: item.quantity,
        unitPrice: item.unit_price, total: item.line_total, note: item.notes ?? "" })),
      discount: tax.order.discount_amount, tax: tax.tax.tax_total,
      total: tax.order.grand_total, currency: "THB",
      note: tax.tax.warning ?? ""
    });
  }
  return renderOfficeDocumentHtml({
    paper, kind, number: receipt.orderNo + (receipt.revision ? "-REV" + receipt.revision : ""),
    issuedAt: receipt.revision ? receipt.documentDate + "T12:00:00+07:00" : receipt.paidAt,
    seller: { name: detail.store.name || receipt.branchName,
      address: detail.store.address, phone: detail.store.phone },
    buyer: { name: receipt.customerName },
    items: receipt.items.map(item => ({ name: item.name, quantity: item.quantity,
      unitPrice: item.unitPrice, total: item.lineTotal, note: item.note })),
    discount: receipt.discountAmount, tax: receipt.taxAmount,
    total: receipt.totalAmount,
    currency: receipt.currency === "LAK" ? "LAK" : "THB",
    paymentMethod: receipt.paymentMethod,
    note: [receipt.note, receipt.revision
      ? "ฉบับแก้ไขครั้งที่ " + receipt.revision + ": " + receipt.correctionReason
      : "สำเนาจากบิล POS วันที่รับเงินจริง " + receipt.paidAt].filter(Boolean).join(" · ")
  });
}
