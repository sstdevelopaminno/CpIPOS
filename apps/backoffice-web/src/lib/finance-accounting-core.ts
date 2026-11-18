/**
 * Deterministic accounting domain rules. No database writes, no POS mutation.
 * Persisting a journal requires an atomic, idempotent server-side transaction
 * after all role, period-lock, tax registration and source evidence checks.
 */
export type FinanceCurrency = "THB" | "LAK" | "USD";
export type FinanceDocumentKind =
  | "sales_quote" | "sales_order" | "delivery_note" | "sales_invoice"
  | "purchase_request" | "purchase_order" | "goods_receipt" | "supplier_bill"
  | "expense_voucher" | "receipt_voucher" | "payment_voucher";
export type FinanceDocumentStatus = "draft" | "submitted" | "approved" | "issued" | "rejected" | "voided";
export type FinanceDocumentAction = "submit" | "approve" | "reject" | "issue" | "void";
export type FinanceAccountingEvent =
  | "pos_paid_sale" | "sales_invoice_issued" | "sales_receipt_applied"
  | "supplier_bill_approved" | "supplier_payment_applied";

export class FinanceCoreError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "FinanceCoreError"; }
}
function assertId(raw: string, field: string): string {
  const id = raw.trim();
  if (id.length < 1 || id.length > 160) throw new FinanceCoreError("finance_" + field + "_invalid");
  return id;
}
function assertNonNegativeMinor(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new FinanceCoreError("finance_" + field + "_invalid");
  return value;
}
function assertCurrency(value: FinanceCurrency) {
  if (value !== "THB" && value !== "LAK" && value !== "USD")
    throw new FinanceCoreError("finance_currency_invalid");
}
function dateUtc(raw: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new FinanceCoreError("finance_date_invalid");
  const date = new Date(raw + "T00:00:00.000Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw)
    throw new FinanceCoreError("finance_date_invalid");
  return date.getTime();
}

/** All amounts are integer currency minor units; LAK is whole kip, THB/USD satang/cents. */
export function currencyToMinor(value: number, currency: FinanceCurrency): number {
  assertCurrency(currency);
  if (!Number.isFinite(value) || value < 0) throw new FinanceCoreError("finance_amount_invalid");
  const multiplier = currency === "LAK" ? 1 : 100;
  const scaled = value * multiplier;
  if (!Number.isSafeInteger(Math.round(scaled)) || Math.abs(scaled - Math.round(scaled)) > 0.000001)
    throw new FinanceCoreError("finance_precision_invalid");
  return Math.round(scaled);
}

export type FinanceDocumentApproval = {
  status: FinanceDocumentStatus;
  preparedBy: string;
  approvedBy: string | null;
  posted: boolean;
};
export function applyFinanceDocumentAction(
  record: FinanceDocumentApproval,
  action: FinanceDocumentAction,
  actorUserId: string
): FinanceDocumentApproval {
  const actor = assertId(actorUserId, "actor");
  assertId(record.preparedBy, "preparer");
  const transitions: Record<FinanceDocumentAction, FinanceDocumentStatus[]> = {
    submit: ["draft", "rejected"],
    approve: ["submitted"],
    reject: ["submitted"],
    issue: ["approved"],
    void: ["issued"]
  };
  if (!transitions[action].includes(record.status))
    throw new FinanceCoreError("finance_transition_forbidden");
  if ((action === "approve" || action === "reject") && actor === record.preparedBy)
    throw new FinanceCoreError("finance_self_approval_forbidden");
  if (action === "void" && record.posted)
    throw new FinanceCoreError("finance_posted_document_requires_reversal");
  if (action === "issue" && !record.approvedBy)
    throw new FinanceCoreError("finance_approval_required");
  const next: Record<FinanceDocumentAction, FinanceDocumentStatus> = {
    submit: "submitted", approve: "approved", reject: "rejected", issue: "issued", void: "voided"
  };
  return {
    ...record, status: next[action],
    approvedBy: action === "approve" ? actor :
      action === "reject" || action === "submit" ? null : record.approvedBy
  };
}

export type FinanceJournalLine = {
  accountId: string;
  currency: FinanceCurrency;
  debitMinor: number;
  creditMinor: number;
};

export function assertBalancedFinanceJournal(lines: readonly FinanceJournalLine[]): void {
  if (lines.length < 2 || lines.length > 200)
    throw new FinanceCoreError("finance_journal_lines_invalid");
  let debits = 0, credits = 0;
  const currency = lines[0].currency;
  assertCurrency(currency);
  for (const line of lines) {
    assertId(line.accountId, "account");
    assertCurrency(line.currency);
    if (line.currency !== currency) throw new FinanceCoreError("finance_journal_mixed_currency");
    const debit = assertNonNegativeMinor(line.debitMinor, "debit");
    const credit = assertNonNegativeMinor(line.creditMinor, "credit");
    if ((debit > 0) === (credit > 0))
      throw new FinanceCoreError("finance_journal_line_side_invalid");
    debits += debit;
    credits += credit;
    if (!Number.isSafeInteger(debits) || !Number.isSafeInteger(credits))
      throw new FinanceCoreError("finance_journal_overflow");
  }
  if (debits === 0 || debits !== credits) throw new FinanceCoreError("finance_journal_unbalanced");
}

/** Unique by tenant, branch, source, source-record ID, and posting event. */
export function financePostingKey(input: {
  tenantId: string; branchId: string; sourceType: string;
  sourceId: string; event: FinanceAccountingEvent;
}): string {
  return [input.tenantId, input.branchId, input.sourceType, input.sourceId, input.event]
    .map((value, index) => encodeURIComponent(assertId(value, "posting_key_" + index))).join("/");
}

export type FinancePostingProposal = {
  postingKey: string;
  currency: FinanceCurrency;
  event: FinanceAccountingEvent;
  lines: FinanceJournalLine[];
};
export function proposeFinanceJournal(input: {
  tenantId: string;
  branchId: string;
  sourceType: string;
  sourceId: string;
  event: FinanceAccountingEvent;
  currency: FinanceCurrency;
  amountMinor: number;
  taxMinor?: number;
  taxVerified: boolean;
  settlementAccountId?: string;
  receivableAccountId?: string;
  payableAccountId?: string;
  revenueAccountId?: string;
  expenseAccountId?: string;
  outputTaxAccountId?: string;
  inputTaxAccountId?: string;
}): FinancePostingProposal {
  assertCurrency(input.currency);
  const total = assertNonNegativeMinor(input.amountMinor, "amount");
  const tax = assertNonNegativeMinor(input.taxMinor ?? 0, "tax");
  if (total === 0 || tax > total) throw new FinanceCoreError("finance_posting_amount_invalid");
  if (tax > 0 && !input.taxVerified) throw new FinanceCoreError("finance_tax_unverified");

  const lines: FinanceJournalLine[] = [];
  const push = (accountId: string | undefined, debitMinor: number, creditMinor: number) => {
    if (!accountId) throw new FinanceCoreError("finance_posting_account_missing");
    lines.push({ accountId: assertId(accountId, "account"), currency: input.currency, debitMinor, creditMinor });
  };
  if (input.event === "pos_paid_sale" || input.event === "sales_invoice_issued") {
    push(input.event === "pos_paid_sale" ? input.settlementAccountId : input.receivableAccountId, total, 0);
    push(input.revenueAccountId, 0, total - tax);
    if (tax > 0) push(input.outputTaxAccountId, 0, tax);
  } else if (input.event === "supplier_bill_approved") {
    push(input.expenseAccountId, total - tax, 0);
    if (tax > 0) push(input.inputTaxAccountId, tax, 0);
    push(input.payableAccountId, 0, total);
  } else if (input.event === "sales_receipt_applied") {
    if (tax !== 0) throw new FinanceCoreError("finance_receipt_tax_invalid");
    push(input.settlementAccountId, total, 0);
    push(input.receivableAccountId, 0, total);
  } else if (input.event === "supplier_payment_applied") {
    if (tax !== 0) throw new FinanceCoreError("finance_payment_tax_invalid");
    push(input.payableAccountId, total, 0);
    push(input.settlementAccountId, 0, total);
  } else throw new FinanceCoreError("finance_posting_event_invalid");
  assertBalancedFinanceJournal(lines);
  return { postingKey: financePostingKey(input), currency: input.currency, event: input.event, lines };
}

export type FinanceAgingRecord = {
  id: string;
  currency: FinanceCurrency;
  dueDate: string;
  originalMinor: number;
  appliedMinor: number;
  voided?: boolean;
};
export type FinanceAgingBuckets = {
  currency: FinanceCurrency;
  currentMinor: number;
  days1to30Minor: number;
  days31to60Minor: number;
  days61to90Minor: number;
  over90Minor: number;
  totalMinor: number;
};

/** Only outstanding approved receivables/payables, as of an explicit Bangkok accounting day. */
export function financeAgingAsOf(
  records: readonly FinanceAgingRecord[], asOfDay: string
): FinanceAgingBuckets[] {
  const asOf = dateUtc(asOfDay);
  const seen = new Set<string>();
  const perCurrency = new Map<FinanceCurrency, FinanceAgingBuckets>();
  for (const record of records) {
    const id = assertId(record.id, "aging_record");
    if (seen.has(id)) throw new FinanceCoreError("finance_aging_duplicate_source");
    seen.add(id);
    assertCurrency(record.currency);
    const original = assertNonNegativeMinor(record.originalMinor, "original_amount");
    const applied = assertNonNegativeMinor(record.appliedMinor, "applied_amount");
    if (applied > original) throw new FinanceCoreError("finance_aging_overallocated");
    if (record.voided || original === applied) continue;
    const days = Math.floor((asOf - dateUtc(record.dueDate)) / 86400000);
    const bucket = perCurrency.get(record.currency) ?? {
      currency: record.currency, currentMinor: 0, days1to30Minor: 0,
      days31to60Minor: 0, days61to90Minor: 0, over90Minor: 0, totalMinor: 0
    };
    const amount = original - applied;
    const key = days <= 0 ? "currentMinor" : days <= 30 ? "days1to30Minor" :
      days <= 60 ? "days31to60Minor" : days <= 90 ? "days61to90Minor" : "over90Minor";
    bucket[key] += amount;
    bucket.totalMinor += amount;
    if (!Number.isSafeInteger(bucket.totalMinor) || !Number.isSafeInteger(bucket[key]))
      throw new FinanceCoreError("finance_aging_overflow");
    perCurrency.set(record.currency, bucket);
  }
  return [...perCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}
