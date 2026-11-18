# Finance accounting core — next development batch (NOT PRODUCTION)

## Completed code on this branch
- Shared A4/A5 office receipt HTML renderer reused by Accountant and POS history.
- Manager/Owner PIN + branch-scoped authorization before server-generated POS A5/A4 receipt copies.
- Pure domain rules for document review/approval, balanced posting proposals, deterministic event idempotency keys and AR/AP aging calculations.

## Scope and explicit non-goals
The current deployment on main **already** contains seven accounting menu shells, completed POS sale reports and Finance-issued tax invoice copies. This branch does NOT enable a complete double-entry accounting database. No financial records, journals, taxes or bank statements have been created or migrated.

## Approval and posting sequence
1. Scope the requesting Finance or POS user to tenant, allowed branch and a verified server-side role; deny direct anonymous access to accounting data.
2. Create a draft document with a unique tenant+branch+type+document number and immutable evidence reference. For PO/GRN links, reconcile item quantities to prevent duplicate stock effects.
3. Submit; a distinct authorized reviewer approves (four-eyes). Record a timestamped immutable approval event.
4. Issue an approved document. For invoices, establish AR or AP due dates and customer/vendor linkage. An unpaid invoice is NOT a cash receipt.
5. Build a proposal from verified source snapshots: integer minor currency units, tax from verified source, explicitly configured chart-of-accounts mapping. Never infer VAT or an FX rate.
6. In one DB transaction: acquire the per-source idempotency key, check period lock, validate that all journal lines have one sign and same currency, assert total debits = total credits, persist entry+lines and durable audit event; commit once. On retry, return the prior posted result with no double book.
7. Matching payment allocations consume true payment source events; AR/AP aging computed from outstanding balances as-of the cutoff, never from POS gross sales alone.
8. Settlement (cash/bank/cheque) posts separately; reconcile against imported bank statement line with immutable fingerprints, not the POS payment mismatch grid.
9. Correction after posting must be an approved reverse or supplemental journal; no updates to posted lines or original paid POS orders.
10. Produce trial balance, P&L and balance sheet only from posted journals after chart-of-accounts and opening balance evidence are verified. VAT and withholding reports only from compliant source records.

## Data model review required
`docs/finance-accounting-core-schema-proposal.sql` is an illustrative **ROLLBACK-only SQL draft**, not a migration. It is not executed, has not undergone a full foreign-key/RLS security review, and should not be copied into production until it passes the full accounting and tenant data-home review.

### Acceptance gates before any database write
- Transactional atomic journal posting and duplicate-event concurrency tests against a staging Supabase project.
- Tenant + branch isolation across all FKs, permissions and queries, including `tenant_data_lifecycle.data_home`.
- Server-side role checks for preparer/reviewer/approver/poster; period close handling.
- Receipt legal labels, VAT registration and invoice number provenance; printed POS copies are not new tax invoices.
- Reprint A5/A4 must be authorized before rendering and must not call thermal spooler twice.
- GitHub CI and staging acceptance, then one reviewed Production migration/deployment.
