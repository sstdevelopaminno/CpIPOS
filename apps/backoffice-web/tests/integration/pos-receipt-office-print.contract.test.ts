import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const source = (file: string) => readFileSync(resolve(process.cwd(),file), "utf8");
const pos = source("src/components/pos-preview/pos-receipts-workspace.tsx");
const api = source("src/app/api/pos/receipts/[orderId]/reprint/route.ts");
const office = source("src/lib/printing/office-document-html.ts");
const finance = source("src/lib/printing/finance-office-print-html.ts");

describe("POS historical-receipt office printing; no duplicate physical prints", () => {
  it("exposes A5/A4 only via the audited reprint PIN workflow, not checkout auto-print", () => {
    expect(pos).toContain('option value="58"');
    expect(pos).toContain('option value="80"');
    expect(pos).toContain('option value="A5"');
    expect(pos).toContain('option value="A4"');
    expect(pos).toContain("office_paper: officePaper ?? undefined");
    expect(pos).toContain('mode !== "office_browser_authorized"');
    expect(pos).toContain("typeof body.data.html !== \"string\"");
    expect(pos).toContain('const nativeWindows = !officePaper && hasLocalWindowsPrintBridge()');
    expect(pos).toContain('printWindowsReceiptHtml(receiptHtml!');
    expect(pos).toContain('manager_pin: reprint.pin');
  });
  it("server independently validates manager PIN, origin branch, completed sale and source data", () => {
    expect(api).toContain('requiredPermission: "receipts:view"');
    expect(api).toContain('requirePosSession()');
    expect(api).toContain('validateManagerPin("sales_record_edit"');
    expect(api).toContain('scope.session.tenant_id !== auth.tenantId');
    expect(api).toContain('body?.office_paper === "A5" || body?.office_paper === "A4"');
    expect(api).toContain("loadFinanceDocument({");
    expect(api).toContain('branchIds: [auth.branchId!]');
    expect(api).toContain("renderFinanceOfficeDocumentHtml({ detail, kind: \"receipt\"");
    expect(api).toContain('action: "receipt_reprint_office_browser_authorized"');
    expect(api).toContain('mode: "office_browser_authorized"');
    const officeBranch = api.indexOf('body?.office_paper === "A5"');
    const thermalQueue = api.indexOf("queueRoutedReceiptReprint({");
    expect(officeBranch).toBeGreaterThan(0);
    expect(thermalQueue).toBeGreaterThan(officeBranch);
  });
  it("shares the same escaped office template with Accountant without disclosing tax metadata", () => {
    expect(office).toContain("function escapeHtml");
    expect(office).toContain("@page { size:");
    expect(finance).toContain('renderOfficeDocumentHtml({');
    expect(finance).toContain('tax.status !== "issued"');
  });
});
