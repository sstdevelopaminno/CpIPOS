import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const workspace = read("src/components/finance/finance-document-workspace.tsx");
const dialog = read("src/components/finance/finance-dialog.tsx");
const page = read("src/app/finance/[module]/page.tsx");
const settingsPage = read("src/app/finance/[group]/[slug]/page.tsx");
const sidebar = read("src/app/finance/finance-sidebar-nav.tsx");
const sales = read("src/components/finance/finance-sales-records-table.tsx");
const main = read("src/components/finance/finance-sales-dashboard.tsx");

describe("Finance bill selection and shared modal behavior", () => {
  it("opens the selected receipt or tax bill in a centered modal, never an inline details card", () => {
    expect(workspace).toContain("void openBill(row.orderId);");
    expect(workspace).toContain("setOpeningOrderId(orderId);");
    expect(workspace).toContain('<FinanceDialog open busy={working} size="xl" onClose={closeDetails}');
    expect(workspace).toContain('title={receipt ? (kind === "tax" ? "รายละเอียดใบกำกับภาษี" : "รายละเอียดใบเสร็จย้อนหลัง")');
    expect(workspace).toContain('aria-live="polite"');
    expect(workspace).toContain("กำลังโหลดรายละเอียดบิล...");
    expect(workspace).not.toContain('<section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">\n          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#e8f0fa]');
    expect(workspace).toContain("onClick={closeDetails}>ปิดรายละเอียด");
  });

  it("ignores slow responses after closing and restores the list, without wiping the POS bill", () => {
    expect(workspace).toContain("detailRequest.current += 1;");
    expect(workspace).toContain("token !== detailRequest.current");
    expect(workspace).toContain("setOpeningOrderId(null)");
    expect(workspace).toContain("setSelected(null)");
    expect(workspace).toContain("setEdit(null)");
    expect(workspace).toContain('disabled={working || openingOrderId !== null}');
    expect(workspace).toContain('setNotice(successText)');
    expect(workspace).toContain('setBuyerModalOpen(false)');
    expect(workspace).toContain('setIssueDialogOpen(false)');
    expect(workspace).toContain('setVoidDialogOpen(false)');
    expect(workspace).not.toMatch(/\bwindow\.(?:alert|confirm)\s*\(/);
  });

  it("supports close, cancel and nested Accountant dialogs without replacing page navigation", () => {
    expect(dialog).toContain("dialog.showModal()");
    expect(dialog).toContain('onCancel={(event) => { event.preventDefault(); dismiss(); }}');
    expect(dialog).toContain('aria-label="ปิดหน้าต่าง"');
    expect(dialog).toContain('if (!busy) onClose()');
    expect(workspace).toContain('<FinanceDialog open={buyerModalOpen}');
    expect(workspace).toContain('<FinanceDialog open={Boolean(edit)}');
    expect(workspace).toContain('<FinanceConfirmDialog open={voidDialogOpen}');
    expect(workspace).toContain('<FinanceConfirmDialog open={issueDialogOpen}');
    expect(page).toContain('<FinanceDocumentWorkspace kind="receipt" />');
    expect(page).toContain('<FinanceDocumentWorkspace kind="tax" />');
    expect(sidebar).toContain('href={href}');
  });

  it("leaves other read-only Finance menus and reports reachable without inventing write actions", () => {
    expect(page).toContain("<FinanceIncomeWorkspace />");
    expect(page).toContain("<FinanceBankingWorkspace />");
    expect(settingsPage).toContain("storeView");
    expect(settingsPage).not.toContain("catalogView");
    expect(page).toContain('requireAccountantPage(item.key)');
    expect(sales).toContain("รายการขายแบบอ่านอย่างเดียว");
    expect(main).toContain("FinanceSalesRecordsTable");
    expect(workspace).toContain('onClick={() => { void openBill(row.orderId); }}');
  });
});
