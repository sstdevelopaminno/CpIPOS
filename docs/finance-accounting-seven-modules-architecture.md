# CpiPOS Finance — phased accounting architecture (design contract)

**Status:** navigation and existing POS-document printing adapters implemented on Draft PR #488. **No full ERP accounting postings, expense/AP/AR master ledgers, statement ingestion or tax return generation are implemented by this change.** Nothing here should be represented as a completed financial statement.

## Existing verified sources

- `orders` / `order_items` and `payments` provide completed POS sales and payment snapshots via `finance-sales-report-service`; report filters are tenant/branch scoped.
- `finance_receipt_revisions` preserves copies and audit history without overwriting original paid POS orders.
- `pos_tax_invoices` contains issued tax invoice snapshots and verified tax/seller/buyer data.
- Finance login uses a separate, expiring role-specific session and all-active-branch Accountant assignment.
- Existing receipt printing uses 58/80 mm POS HTML templates. The Finance document print route now selects the office-sized A5/A4 reusable HTML adapter for previously issued documents.
- Current POS payment mismatch report compares recorded payments **to orders**, not to bank statements.

## Proposed accounting entity ownership (not yet migrated)

| Source / table proposal | Owner | Immutable / posting rules |
| --- | --- | --- |
| `finance_parties`, `finance_party_contacts` | AR/AP | Tenant-scoped customers/suppliers; unique external identity only per tenant |
| `finance_sales_documents`, `finance_sales_document_lines` | AR | Quote → order → delivery → invoice; status and source_id; never silently recreate a POS order |
| `finance_receivable_allocations` | AR | Payments allocate to invoice balances; aged debt calculated as-of a cutoff date |
| `finance_purchase_documents`, `finance_purchase_document_lines` | AP | Request → purchase order → goods receipt → supplier bill → payment voucher |
| `finance_payable_allocations` | AP | Payment allocation and due dates; multi-currency and branch segregation |
| `finance_cash_accounts`, `finance_bank_accounts`, `finance_bank_statement_lines` | Treasury | Secure owner-defined accounts, reconciled against immutable bank statement references |
| `finance_bank_matches` | Treasury | One-to-one or many-to-one deterministic matches plus exception handling |
| `finance_chart_accounts`, `finance_journals`, `finance_journal_lines` | GL | Balanced debits and credits, period locking, immutable posted journal |
| `finance_tax_events`, `finance_wht_certificates` | Tax | Derived only from eligible source documents with verified tax profiles |

These are **proposed names, not claims about current database schema**. Do not create them until actual Supabase schema, RLS and role/branch permissions have been reviewed.

## Posting and safety invariants

1. Source-of-truth POS order remains unchanged. Creating a finance receipt copy or printing it **must not** create a second sale or a second cash receipt.
2. An accounting event has `tenant_id`, `branch_id`, `source_system`, `source_type`, `source_id`, `event_type`, `currency`, posting date and idempotency key. Enforce uniqueness for posting source+event and transaction boundaries for journal + lines + audit.
3. Posted double-entry journal must satisfy `sum(debit)=sum(credit)` **per currency**. Never convert currency without persisted FX rate and valuation metadata.
4. An unpaid invoice creates AR, not cash. An approved AP bill creates AP, not a payment. Bank settlement is a separate event reconciled against a statement.
5. Minimum permissions: preparer, reviewer, approver, poster; approval limits, locked periods, audit trail and reversal journal rules enforced on the server.
6. VAT issuance is conditioned on verified seller VAT status and source tax snapshots. P.P.30 / WHT reporting must aggregate eligible true documents and reflect current Revenue Department layouts; no empty or inferred tax IDs.
7. Document numbers are per tenant, branch, document type and series; draft/issued/voided distinction, correction and cancellation preserved; never reuse a tax invoice number after issuance.
8. All stored timestamps include timezone; presentation/reporting uses Asia/Bangkok, separate accounting date and payment date.
9. Print sizes: 58/80 mm for thermal POS receipts, A5/A4 portrait for office copies. Paper formatting changes display only; totals, seller identity and legal status remain those on the source document.
10. Deployment gate: tests → permission review → verify migrations/RLS → staged backfill (if any) → reconcile → one controlled Production deployment.

## Seven-module routing

- `/finance/income` — actual completed POS sales/payments reporting (not posted GL income).
- `/finance/expenses` — documented future expense workflow, no fake balances.
- `/finance/sales-receivables` — receipt copies from POS; AR documents/aging scheduled for schema phase.
- `/finance/purchases-payables` — future procurement/AP documents/aging, no fake balances.
- `/finance/banking` — POS payment mismatch report only, clearly not Bank Reconciliation.
- `/finance/ledger` — future chart of accounts, journal and financial statements.
- `/finance/tax-reports` — actual tax invoices and copies from the existing source, no P.P.30/PND reports yet.

Legacy `/finance/more/*` routes are denied. Existing `/api/finance/documents` and print endpoints are gated by new role-specific menu keys. The POS sale/stock operations and printing service for existing thermal receipts are unchanged.
