import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const shell = source("src/app/finance/finance-accountant-shell.tsx");
const sidebar = source("src/app/finance/finance-sidebar-nav.tsx");
const logout = source("src/app/finance/finance-logout.tsx");
const layout = source("src/app/finance/layout.tsx");
const service = source("src/lib/server/finance-accountant-readonly-services.ts");
const settingsPage = source("src/app/finance/[group]/[slug]/page.tsx");
const modulePage = source("src/app/finance/[module]/page.tsx");
const packagePage = source("src/app/finance/package-payment/page.tsx");
const documentApi = source("src/app/api/finance/documents/route.ts");
const printApi = source("src/app/api/finance/documents/print/route.ts");
const workspace = source("src/components/finance/finance-document-workspace.tsx");
const office = source("src/lib/printing/office-document-html.ts");
const officeAdapter = source("src/lib/printing/finance-office-print-html.ts");

describe("Accountant financial workbench, authorization and print contracts", () => {
  it("keeps sidebar logo and collapse behavior and lists Finance modules without More", () => {
    expect(shell).toContain('src="/brand/cpipos-symbol-transparent.png"');
    expect(shell).toContain("window.localStorage.getItem(STORAGE_KEY)");
    expect(shell).toContain("window.localStorage.setItem(STORAGE_KEY");
    expect(shell).toContain('"md:w-[76px]" : "md:w-[252px]"');
    expect(sidebar).toContain('aria-label="ยุบหรือขยายเมนูย่อยการเงิน"');
    expect(sidebar).toContain('href="/finance"');
    expect(sidebar).toContain('href="/finance/package-payment"');
    expect(sidebar).toContain('const href = "/finance/" + item.slug');
    expect(sidebar).not.toContain("finance-more-menu");
    expect(sidebar).not.toContain("moreItems");
    expect(layout).toContain("ACCOUNTANT_FINANCE_MENU.filter(item => visible(item.key))");
    expect(layout).toContain("requireFinanceSession()");
    expect(shell).toContain("<FinanceLogout collapsed={collapsed} />");
    expect(logout).toContain('fetch("/api/auth/accounting/logout"');
  });

  it("blocks retired More routes and protects each finance module on server", () => {
    expect(settingsPage).toContain("accountantMenuItem(group, slug)");
    expect(settingsPage).toContain("if (!item) notFound()");
    expect(modulePage).toContain("accountantFinanceModule(slug)");
    expect(modulePage).toContain("if (!item) notFound()");
    expect(modulePage).toContain("requireAccountantPage(item.key)");
    expect(modulePage).toContain("<FinanceIncomeWorkspace />");
    expect(modulePage).toContain("<FinanceBankingWorkspace />");
    expect(modulePage).toContain('<FinanceAccountingRegister module="expenses" />');
    expect(modulePage).toContain('<FinanceDocumentWorkspace kind="receipt" />');
    expect(modulePage).toContain('<FinanceDocumentWorkspace kind="tax" />');
    expect(service).toContain('import "server-only"');
    expect(service).toContain('.eq("tenant_id", identity.tenantId)');
    expect(service).not.toMatch(/\.(insert|update|upsert|delete|rpc)\s*\(/);
    expect(packagePage).toContain('requireAccountantPage("main.package_payment")');
  });

  it("reauthorizes existing receipt/tax endpoints without reopening More grants", () => {
    expect(documentApi).toContain('"finance.sales_receivables"');
    expect(documentApi).toContain('"finance.tax_reports"');
    expect(printApi).toContain('"finance.sales_receivables"');
    expect(printApi).toContain('"finance.tax_reports"');
    expect(documentApi).not.toContain('"more.receipts"');
    expect(printApi).not.toContain('"more.tax_invoices"');
    expect(printApi).toContain('loadFinanceDocument(identity, params.get("orderId")');
    expect(printApi).toContain("finance_print_audit_unavailable");
  });

  it("preserves 58/80 POS print templates and adds A5/A4 office copies", () => {
    expect(workspace).toContain('<option value={58}>58 มม.</option>');
    expect(workspace).toContain('<option value="A5">A5 แนวตั้ง</option>');
    expect(workspace).toContain('<option value="A4">A4 แนวตั้ง</option>');
    expect(printApi).toContain('renderReceiptHtml({');
    expect(printApi).toContain('buildTaxInvoicePrintHtml({');
    expect(printApi).toContain('renderFinanceOfficeDocumentHtml({ detail, kind: "tax", paper: width })');
    expect(printApi).toContain('renderFinanceOfficeDocumentHtml({ detail, kind: "receipt", paper: width })');
    expect(office).toContain("@page { size:");
    expect(office).toContain("escapeHtml");
    expect(officeAdapter).toContain('tax.status !== "issued"');
    expect(office).toContain("ไม่ใช่การบันทึกรายการรับเงินหรือออกใบกำกับภาษีใหม่");
  });
});
