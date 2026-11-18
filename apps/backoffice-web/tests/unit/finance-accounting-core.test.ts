import { describe, it, expect } from "vitest";
import {
  applyFinanceDocumentAction, assertBalancedFinanceJournal, currencyToMinor,
  financeAgingAsOf, financePostingKey, proposeFinanceJournal, FinanceCoreError
} from "../../src/lib/finance-accounting-core";

describe("Finance posting core: no silent write, no duplicate sale, no unbalanced journal", () => {
  const source = {
    tenantId: "tenant-a", branchId: "branch-1", sourceType: "pos_order",
    sourceId: "paid-001", event: "pos_paid_sale" as const
  };
  it("uses a deterministic tenant/branch/source/event key for idempotent database posting", () => {
    expect(financePostingKey(source)).toEqual(financePostingKey({ ...source }));
    expect(financePostingKey(source)).not.toEqual(financePostingKey({ ...source, sourceId: "paid-002" }));
    expect(financePostingKey(source)).not.toEqual(financePostingKey({ ...source, branchId: "branch-2" }));
    expect(financePostingKey(source)).not.toEqual(financePostingKey({ ...source, event: "sales_invoice_issued" }));
  });
  it("generates balanced POS sale journal based on actual confirmed tax snapshot", () => {
    const posting = proposeFinanceJournal({
      ...source, currency: "THB", amountMinor: 10700, taxMinor: 700, taxVerified: true,
      settlementAccountId: "1001", revenueAccountId: "4001", outputTaxAccountId: "2104"
    });
    expect(posting.lines).toEqual([
      { accountId: "1001", currency: "THB", debitMinor: 10700, creditMinor: 0 },
      { accountId: "4001", currency: "THB", debitMinor: 0, creditMinor: 10000 },
      { accountId: "2104", currency: "THB", debitMinor: 0, creditMinor: 700 }
    ]);
    expect(() => assertBalancedFinanceJournal(posting.lines)).not.toThrow();
  });
  it("does not infer VAT or invent an account mapping", () => {
    const common = {
      ...source, currency: "THB" as const, amountMinor: 10700, taxMinor: 700,
      settlementAccountId: "1001", revenueAccountId: "4001", outputTaxAccountId: "2104"
    };
    expect(() => proposeFinanceJournal({ ...common, taxVerified: false }))
      .toThrowError("finance_tax_unverified");
    expect(() => proposeFinanceJournal({ ...common, taxVerified: true, outputTaxAccountId: undefined }))
      .toThrowError("finance_posting_account_missing");
  });
  it("rejects double-sided, mixed currency, and unbalanced journal lines", () => {
    expect(() => assertBalancedFinanceJournal([
      { accountId: "1001", currency: "THB", debitMinor: 100, creditMinor: 0 },
      { accountId: "4001", currency: "THB", debitMinor: 0, creditMinor: 99 }
    ])).toThrowError("finance_journal_unbalanced");
    expect(() => assertBalancedFinanceJournal([
      { accountId: "1001", currency: "THB", debitMinor: 100, creditMinor: 0 },
      { accountId: "4001", currency: "USD", debitMinor: 0, creditMinor: 100 }
    ])).toThrowError("finance_journal_mixed_currency");
    expect(() => assertBalancedFinanceJournal([
      { accountId: "1001", currency: "THB", debitMinor: 100, creditMinor: 100 },
      { accountId: "4001", currency: "THB", debitMinor: 0, creditMinor: 100 }
    ])).toThrowError("finance_journal_line_side_invalid");
  });
  it("separates approval from preparation and forbids voiding posted documents", () => {
    const draft = { status: "draft" as const, preparedBy: "alice", approvedBy: null, posted: false };
    const submitted = applyFinanceDocumentAction(draft, "submit", "alice");
    expect(submitted.status).toBe("submitted");
    expect(() => applyFinanceDocumentAction(submitted, "approve", "alice"))
      .toThrowError("finance_self_approval_forbidden");
    const approved = applyFinanceDocumentAction(submitted, "approve", "bob");
    const issued = applyFinanceDocumentAction(approved, "issue", "alice");
    expect(issued.status).toBe("issued");
    expect(approved.approvedBy).toBe("bob");
    expect(() => applyFinanceDocumentAction({ ...issued, posted: true }, "void", "bob"))
      .toThrowError("finance_posted_document_requires_reversal");
  });
  it("computes aging of partial receivables per currency with no invented cash", () => {
    const aging = financeAgingAsOf([
      { id: "a", currency: "THB", dueDate: "2026-11-18", originalMinor: 30000, appliedMinor: 10000 },
      { id: "b", currency: "THB", dueDate: "2026-10-15", originalMinor: 15000, appliedMinor: 0 },
      { id: "c", currency: "USD", dueDate: "2026-09-01", originalMinor: 2500, appliedMinor: 0 },
      { id: "d", currency: "THB", dueDate: "2026-08-01", originalMinor: 8000, appliedMinor: 0, voided: true }
    ], "2026-11-18");
    expect(aging).toEqual([
      { currency: "THB", currentMinor: 20000, days1to30Minor: 0, days31to60Minor: 15000,
        days61to90Minor: 0, over90Minor: 0, totalMinor: 35000 },
      { currency: "USD", currentMinor: 0, days1to30Minor: 0, days31to60Minor: 0,
        days61to90Minor: 2500, over90Minor: 0, totalMinor: 2500 }
    ]);
  });
  it("rejects over-allocation, duplicate debts and amounts with invalid precision", () => {
    expect(currencyToMinor(25.50, "THB")).toBe(2550);
    expect(currencyToMinor(260, "LAK")).toBe(260);
    expect(() => currencyToMinor(25.555, "THB")).toThrowError("finance_precision_invalid");
    expect(() => financeAgingAsOf([
      { id: "x", currency: "THB", dueDate: "2026-11-18", originalMinor: 100, appliedMinor: 150 }
    ], "2026-11-18")).toThrowError("finance_aging_overallocated");
    expect(() => financeAgingAsOf([
      { id: "x", currency: "THB", dueDate: "2026-11-18", originalMinor: 100, appliedMinor: 0 },
      { id: "x", currency: "THB", dueDate: "2026-11-18", originalMinor: 100, appliedMinor: 0 }
    ], "2026-11-18")).toThrow(FinanceCoreError);
  });
  it("generates AP payment and invoice entries with correct debit/credit direction", () => {
    const bill=proposeFinanceJournal({
      ...source, event: "supplier_bill_approved", sourceType: "supplier_bill",
      currency: "THB", amountMinor: 20000, taxMinor: 0, taxVerified: false,
      payableAccountId: "2001", expenseAccountId: "5001"
    });
    expect(bill.lines[0].debitMinor).toBe(20000);
    expect(bill.lines[1].creditMinor).toBe(20000);
    const paid=proposeFinanceJournal({
      ...source, event: "supplier_payment_applied", sourceType: "supplier_payment",
      currency: "THB", amountMinor: 20000, taxVerified: false,
      payableAccountId: "2001", settlementAccountId: "1002"
    });
    expect(paid.lines[0].debitMinor).toBe(20000);
    expect(paid.lines[1].creditMinor).toBe(20000);
  });
});
