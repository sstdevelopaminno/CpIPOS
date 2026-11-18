import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ACCOUNTANT_FINANCE_MENU, accountantFinanceModule, isAccountantMenuVisible
} from "../../src/lib/accountant-menu-policy";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/app/finance/[module]/page.tsx");
const sidebar = read("src/app/finance/finance-sidebar-nav.tsx");
const ledger = read("src/components/finance/finance-accounting-register.tsx");
const posted = read("src/components/finance/finance-posted-journals.tsx");
const documents = read("src/components/finance/finance-document-workspace.tsx");
const journalService = read("src/lib/server/finance-accounting-workflow.ts");
const receiptApi = read("src/app/api/finance/documents/route.ts");

describe("Separate Accountant POS receipt history and posted journal navigation", () => {
  it("adds dedicated Finance links with stable unique keys and no additional POS menu grants", () => {
    const slugs = ACCOUNTANT_FINANCE_MENU.map(item => item.slug);
    expect(slugs).toEqual([
      "income", "expenses", "sales-receivables", "pos-receipts",
      "purchases-payables", "banking", "ledger", "posted-journals", "tax-reports"
    ]);
    expect(new Set(ACCOUNTANT_FINANCE_MENU.map(item => item.key)).size)
      .toBe(ACCOUNTANT_FINANCE_MENU.length);
    expect(accountantFinanceModule("pos-receipts")?.label).toBe("ใบเสร็จย้อนหลังจาก POS");
    expect(accountantFinanceModule("posted-journals")?.label).toBe("สมุดรายวันที่โพสต์แล้ว");
    expect(sidebar).toContain('"pos-receipts": "receipt"');
    expect(sidebar).toContain('"posted-journals": "list"');
    expect(sidebar).toContain('const href = "/finance/" + item.slug');
  });

  it("retains existing source-module deny rules for new direct URLs", () => {
    for (const [newKey, sourceKey] of [
      ["finance.pos_receipts", "finance.sales_receivables"],
      ["finance.posted_journals", "finance.ledger"]
    ]) {
      expect(isAccountantMenuVisible(newKey, {})).toBe(true);
      expect(isAccountantMenuVisible(newKey, { [sourceKey]: false })).toBe(false);
      expect(isAccountantMenuVisible(newKey, { [newKey]: false })).toBe(false);
      expect(isAccountantMenuVisible(newKey, { "main.finance": false })).toBe(false);
    }
    expect(page).toContain("requireAccountantPage(item.key)");
  });

  it("moves POS receipts out of the sales/receivables register but keeps original secure endpoints", () => {
    expect(page).toContain('slug === "sales-receivables" && <FinanceAccountingRegister module="sales-receivables" />');
    expect(page).toContain('slug === "pos-receipts" && <FinanceDocumentWorkspace kind="receipt" />');
    expect(page).toContain('slug === "tax-reports"');
    expect(documents).toContain("void openBill(row.orderId)");
    expect(receiptApi).toContain('"finance.sales_receivables"');
    expect(receiptApi).not.toContain('"more.receipts"');
  });

  it("moves posted journals out of chart-of-accounts and keeps them read-only", () => {
    expect(page).toContain('slug === "ledger" && <FinanceAccountingRegister module="ledger" />');
    expect(page).toContain('slug === "posted-journals" && <FinancePostedJournals />');
    expect(ledger).not.toContain("สมุดรายวันที่โพสต์แล้ว");
    expect(ledger).not.toContain("view=journals&branchId=");
    expect(posted).toContain("view=journals&branchId=");
    expect(posted).toContain("view=journal_detail&journalId=");
    expect(posted).toContain('<FinanceDialog open={Boolean(selected)}');
    expect(posted).toContain('credentials: "same-origin", cache: "no-store"');
    expect(posted).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
    expect(posted).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    expect(journalService).toContain('await authorize(identity,"finance.ledger")');
    expect(journalService).toContain('.eq("tenant_id",identity.tenantId).in("branch_id",identity.branchIds)');
  });
});
