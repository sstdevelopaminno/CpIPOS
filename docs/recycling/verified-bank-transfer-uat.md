# Recycling bank transfer — development draft / NOT a production migration

## Scope and release gates
- Existing cash and credit RPCs remain untouched; bank transfers continue to fail closed in the production cashier.
- Manual bank-statement verification is a distinct human approval, not automatic bank or OCR verification. Approver must be a different authorized owner/manager/accountant. The API must authenticate both identities and derive tenant/branch from session.
- Finance must provision actual branch bank accounts with evidence of ownership and prepare account 1110 (asset). A masked account suffix is display only, not proof of account ownership.
- A confirmed statement entry must match the server-calculated gross amount exactly in satang and direction; for a VAT sale the gross includes VAT.
- The draft binds evidence to the entire cart hash, request ID, shift, operator, branch and tenant. Posting locks and consumes it in the same database transaction as stock, receipts and journal entries. Unique tenant/bank/reference rejects reuse across Recycling branches. No cash-drawer movement for bank transfers.
- This prototype requires a separate API and reviewer UI, explicit rollout flag, replay-safe approval response, evidence cancellation and recovery workflow, and cross-mode duplicate reconciliation with ordinary POS. The current ordinary POS OCR service rounds to whole baht and can run in mock mode, and is not an acceptable bank verification authority.
- Bank transfer VOID/reversal remains blocked; require separate accounting correction and bank evidence.
- **Do not run this draft in Production.** Compare with current database definition, add a canonical migration only after PostgreSQL and Supabase staging acceptance. No credentials or customer transactions in tests.

## Required synthetic acceptance
1. Real synthetic cash and VAT transactions remain unchanged; bank RPC rejects cash/credit.
2. No evidence, wrong branch, wrong shift, wrong operator, wrong direction, changed cart, inactive account, or same reviewer/operator: reject with no writes.
3. Statement reference duplicate in same tenant across branches is rejected; cross-tenant isolation verified.
4. Wrong amount (including one satang or missing VAT) rolls back stock, receipt counter, subledger, and evidence consumption.
5. Successful buy: DR 1200 inventory / CR 1110 bank. Successful sell: DR 1110 gross / CR 4100 net and CR 2200 VAT, plus COGS/inventory; drawer cash unchanged.
6. Same posting request retry returns original receipt, even after evidence consumed. Concurrent requests cannot reuse evidence. Test two concurrent approvals and postings.
7. Test failure after consumption/update and confirm rollback; verify evidence immutability and cancellation workflow before rollout.
8. Check RLS, service-role-only grants, actual branch authorization, bank account ownership, shift rollover, evidence access and redaction, and reconciliation across general POS.
