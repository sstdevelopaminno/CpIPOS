import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const service = read("src/lib/server/finance-document-service.ts");
const api = read("src/app/api/finance/documents/route.ts");
const print = read("src/app/api/finance/documents/print/route.ts");
const ui = read("src/components/finance/finance-document-workspace.tsx");
const page = read("src/app/finance/[module]/page.tsx");
const dashboard = read("src/components/finance/finance-sales-dashboard.tsx");
const migration = read("../../supabase/migrations/20261118070000_finance_receipt_append_only_revisions.sql");

describe("Accountant Finance receipts and tax invoice workflows", () => {
  it("uses only Finance session and IT menu policy on all document endpoints", () => {
    expect(api).toContain("await requireFinanceSession()");
    expect(api).toContain("isAccountantMenuVisible(menuKey, overrides)");
    expect(api).toContain('authorized("finance.sales_receivables")');
    expect(api).toContain('authorized("finance.tax_reports")');
    expect(api).toContain('request.headers.get("origin") !== new URL(request.url).origin');
    expect(print).toContain("requireFinanceSession()");
    expect(print).toContain('isAccountantMenuVisible(kind === "tax"');
    expect(api).not.toContain("requirePosSession");
  });

  it("keeps original POS sale immutable, records revisions separately with concurrency guard", () => {
    expect(service).toContain('db.from("orders")');
    expect(service).toContain('.eq("tenant_id", identity.tenantId)');
    expect(service).toContain('.in("branch_id", identity.branchIds)');
    expect(service).toContain('.eq("status", "paid")');
    expect(service).toContain('db.from("finance_receipt_revisions").insert({');
    expect(service).toContain('old.receipt.revision + 1');
    expect(service).toContain('finance_receipt_revision_conflict');
    expect(service).toContain('finance_document_total_mismatch');
    expect(service).toContain('finance_tax_invoice_requires_credit_or_replacement');
    expect(service).not.toContain('db.from("orders").update(');
    expect(service).not.toContain('db.from("orders").delete(');
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("finance_receipt_revisions_version_uniq");
    expect(migration).toContain("BEFORE UPDATE OR DELETE");
    expect(migration).toContain("GRANT SELECT, INSERT ON TABLE public.finance_receipt_revisions TO service_role");
    expect(migration).toContain("actor_user_id uuid NOT NULL");
  });

  it("reuses POS print format and prevents reprint of voided receipts or non-issued tax invoices", () => {
    expect(print).toContain("renderReceiptHtml({");
    expect(print).toContain("buildTaxInvoicePrintHtml({");
    expect(print).toContain('finance_receipt_voided');
    expect(print).toContain('finance_tax_invoice_not_issued');
    expect(print).toContain('finance_print_currency_unsupported');
    expect(print).toContain('"Cache-Control": "private, no-store');
  });

  it("does not infer VAT registration or tax for historical invoices", () => {
    expect(service).toContain('taxSettings.vat_registration_verified !== true');
    expect(service).toContain('finance_tax_seller_vat_profile_required');
    expect(service).toContain('finance_tax_invoice_thb_only');
    expect(service).toContain('finance_tax_billed_tax_missing');
    expect(service).toContain('isValidThaiTaxId');
    expect(service).toContain('taxInvoiceNumber(String(o.order_no))');
    expect(service).toContain('finance_tax_invoice_issue_requested');
    expect(service).toContain('finance_tax_invoice_issued');
    expect(service).toContain('createAccountantTaxBuyer(');
  });

  it("has separate receipts and tax views, document filters and correction/void UI", () => {
    expect(page).toContain('<FinanceDocumentWorkspace kind="receipt" />');
    expect(page).toContain('<FinanceDocumentWorkspace kind="tax" />');
    expect(ui).toContain("พิมพ์ใบเสร็จย้อนหลัง");
    expect(ui).toContain("พิมพ์สำเนาใบกำกับภาษี");
    expect(ui).toContain("แก้ไขฉบับเอกสาร");
    expect(ui).toContain("บันทึกฉบับแก้ไข");
    expect(ui).toContain("ยืนยันยกเลิกเอกสาร");
    expect(ui).toContain("create_buyer");
    expect(ui).toContain("issue_tax");
    expect(dashboard).toContain("CpiPOS FINANCE");
    expect(dashboard).not.toContain('bg-[#0c345e]');
  });
});
