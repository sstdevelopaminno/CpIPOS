# CpiPOS CUSTOM Recycling – staging / go-live acceptance

**Status:** Development plan only. Never run these tests against the CpiPOS-001 production database. Use a separate approved test environment and synthetic tenants/branches; there is no copy of customer transactions. **No Production SQL migrations or real settlement are authorized by this document.**

## Scope

Shop 155858, ส.เจริญทรัพย์รุ่งเรื่อง รีไซเคิล, is an existing CUSTOM-trial tenant. It may use ordinary General Sale while that mode is granted by IT. Recycling is a separate, opt-in sales mode. This implementation is NOT a tax-invoicing feature.

### Preconditions
- A test branch/project with its own Supabase data and secrets.
- Staged migration generated/verified with Supabase CLI, RLS on all exposed tables, service-role-only RPC grants. Deploy the API only against staging.
- `RECYCLING_STOCK_SCHEMA_READY=1` only in a verified staging schema.
- `RECYCLING_TRANSACTION_WRITES_ENABLED=1` **only** in staging and only after the atomic RPC and finance reconciler have passed validation.
- `RECYCLING_FINANCE_GL_POSTING_ENABLED=1` only in staging after Finance chart-of-accounts and independent-approver UAT. Default must remain OFF.
- `RECYCLING_VOID_ENABLED=1` only after separate supervisor/physical-stock/cash-return UAT; off by default. Only an open shift, unposted-to-Finance transaction, and most-recent stock movement may be voided.
- Staging must install and check `docs/recycling/phase3_finance_gl_bridge_draft.sql` **after** phase2, then `docs/recycling/phase4_void_unposted_transaction_draft.sql` **after** phase3. All three are review drafts, not production migrations.
- Synthetic owner, manager, cashier, accountant, kitchen, and unauthorized user; test devices, open/closed shifts and trial expirations.
- Synthetic material records with independent buy/sell prices; no production data.
- IT enables `sales_modes.recycling=true` explicitly for the synthetic CUSTOM tenant; General Sale alone must not allow Recycling.
- Confirm material barcode uniqueness per tenant/branch.

## Required cases and expected results

| ID | Scenario | Expected outcome |
| --- | --- | --- |
| AUTH-01 | Active CUSTOM with `general_sale=true`, no package feature row (same condition as 155858) | Cashier entry allowed subject to lifecycle, employee and device checks. Does **not** grant Recycling access. |
| AUTH-02 | CUSTOM with no explicitly selected sales modes | Entry denied; package assignment alone never grants access. |
| AUTH-03 | Explicit `tenant_feature_subscriptions.core_pos_sales=false` | Denied even when General Sale or Recycling is on. |
| AUTH-04 | Branch override denies core sales | Branch denied; other authorized branches unaffected. |
| AUTH-05 | Trial expired, cancelled/locked tenant or inactive device | Entry denied, even if a feature grant remains cached. |
| AUTH-06 | Standard Starter/Growth/Business, non-Recycling tenant | Existing pages, sales entitlement and stock unchanged. |
| MODE-01 | CUSTOM + no `recycling=true` | No access to Recycling routes or APIs. |
| MODE-02 | CUSTOM + explicitly enabled Recycling | Dedicated scanner, quantity popup, separated buy/sell cart. |
| MAT-01 | Two materials with same SKU in same tenant/branch | Duplicate SKU rejected. |
| MAT-02 | Owner/manager edits buy and sell prices | Only material of current tenant/branch modified. Staff cannot edit. |
| MAT-03 | Attempt to edit other-tenant/non-Recycling product | Rejected, no change to that product. |
| UNIT-01 | 1kg/10ขีด/1000g equal, and 1 ton equals 1000kg | Same priced quantity and final amount. |
| UNIT-02 | 0.5kg × 3.01THB/kg | Amount is **1.51 THB**, matching PostgreSQL numeric rounding. |
| UNIT-03 | Piece/stem-counted material, fractional piece or stem | Rejected. Weight unit for piece/stem or piece/stem for kg rejected. `ต้น` must not be confused with `ตัน`. |
| UNIT-04 | Negative, zero, invalid or weight less than 1 gram | Rejected; no state change. |
| BUY-01 | Buy 2.5kg at 8.25THB/kg, cash | Total **20.63 THB** (2063 satang); inventory +2.5kg, inventory value +2063; subledger DR Inventory 2063, CR Cash 2063. |
| SELL-01 | Sell 1kg at 10.00THB/kg from BUY-01 | Total **10.00 THB** (1000 satang); inventory 1.5kg remaining, carrying cost 1238 satang; subledger DR Cash 1000, CR Revenue 1000, DR COGS 825, CR Inventory 825. |
| SELL-02 | Sell more than remaining stock | Reject entire transaction; no partial sales or ledger rows. |
| POST-01 | Identical `request_id` retried after successful commit | Exactly one transaction, unchanged stock and ledger; original receipt ID returned. |
| POST-02 | Reused `request_id` with modified cart/settlement | Rejected as `recycling_request_key_reused`. |
| POST-03 | Simultaneous sales try to exhaust same stock | Row locks prevent negative inventory; exactly allowed portion commits. |
| POST-04 | Client price stale vs current catalog | Reject; cashier must refresh and confirm new price. |
| POST-05 | Transaction with closed shift or unauthorized branch/user | Reject, with no writes. |
| POST-06 | Invalid later line after valid first line | Entire transaction rolls back, including stock balances, entry rows and document header. |
| POST-07 | Server/API running without verified migration | Fail closed with controlled 503; never pretend a bill was recorded. |
| FIN-01 | Per-transaction entry sum | **sum(debit_minor) = sum(credit_minor)**, for purchase and sale. |
| FIN-02 | Settlement = credit | Purchase booked as payable; sale booked as receivable; no fictional cash movement. |
| FIN-03 | Finance GL bridge | Review `phase3_finance_gl_bridge_draft.sql`. Require a *different* active branch accountant than the source cashier; create linked Finance document and two-to-four-line GL journal with source snapshot, posting key and audit events. Reconcile all totals; **staging UAT not yet completed**. |
| FIN-04 | Cancellation/refund/void | **Restricted same-shift VOID implemented and tested in isolated PostgreSQL**: approved by a different owner/manager/accountant, stock reconfirmed, cash refund acknowledged, no later stock movement, not yet posted GL, with immutable original receipt and status VOID. **Bank transfer refunds, closed shifts and already-posted Finance documents remain blocked** pending formal accounting adjustment/credit-note workflow. |
| SHIFT-01 | 100 THB opening cash, buy 20.63 THB cash, sell 10 THB cash | Expected cash is **89.37 THB**. Bank transfers and credit must not inflate drawer cash. |
| SHIFT-02 | Two concurrent purchases attempt to overdraw cash float | Shift row lock and cash movement calculation prevent negative drawer balance. |
| SHIFT-03 | Ordinary POS order and recycling transaction in one shift | Reject mixed ledger, require documented cross-ledger reconciliation before close. |
| SHIFT-04 | A new transaction arrives during cashier close | DB close trigger recalculates and stores final shift cash/bank totals under the row lock, avoiding stale client results. |
| SHIFT-05 | Close a shift without physical cash count | Reject when Recycling contains posted records. |
| SHIFT-06 | Trial expires after a valid transaction | Cash/shift reconciliation for historical records still required even if new writes are disabled. |
| VOID-01 | Cash sale/purchase error before shift closes and before Finance GL posting | Independent supervisor/accountant approves with evidence that stock physically matches and cash was returned/refunded. Original receipt persists with VOID watermark. |
| VOID-02 | Credit transaction before GL, no later movement | Reverse inventory exactly to the immutable pre-transaction snapshots, mark VOID, exclude from live subledger/shift totals, retain original journal audit evidence. |
| VOID-03 | Same request ID retried after success | Original VOID approval returned idempotently; conflicting new approval rejected. |
| VOID-04 | Same actor as original cashier, settled bank transfer, later inventory movement, locked shift or posted GL | Refuse unsafe VOID, no stock or account write. |
| VOID-05 | Receipt already marked VOID | Clearly show VOID on printable 58/80mm copies and historical detail. |
| FIN-05 | VAT/tax invoice | Disabled until merchant VAT status, numbering, legal invoice fields and tax policies verified. |
| PRINT-01 | Material purchase/sale receipts | Implemented draft: immutable SKU/name/price/quantity snapshots, unique `RCY-B/S-...` purchase/sale reference, Print Agent queue/browser print and visible VOID watermark on cancelled copies. Must physically test 58/80mm drivers and Android/Windows; **not a tax invoice**. |

## Read-only staging verification SQL

```sql
-- Audit RLS and server-only RPC privileges.
select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname like 'recycling_%'
  and c.relkind='r';

select p.proname, p.prosecdef as security_definer,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_can_execute
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('recycling_post_transaction','recycling_finance_post_transaction');

-- Every posted transaction must balance (run on synthetic staging records).
select t.id, t.tenant_id, t.branch_id, t.direction,
  coalesce(sum(e.debit_minor),0) debit_minor,
  coalesce(sum(e.credit_minor),0) credit_minor
from public.recycling_transactions t
left join public.recycling_accounting_entries e on e.transaction_id=t.id
group by t.id,t.tenant_id,t.branch_id,t.direction
having coalesce(sum(e.debit_minor),0) <> coalesce(sum(e.credit_minor),0);
```

## Release blockers / sign-off

1. Supabase staging branch requires separate cost approval; do **not** create without confirmation.
2. Run and review draft `docs/recycling/phase2_transaction_schema_draft.sql` on a cost-approved staging branch, fix SQL/API discrepancies, and generate an ordered canonical migration.
3. Finish real Supabase staging review of the drafted Finance GL bridge and immutable purchase/sale receipts. The restricted same-shift VOID implementation is tested in synthetic PostgreSQL, but formal refund/credit-note workflows for **bank transfers, closed shifts and already-posted GL**, plus tax/legal policy, remain release restrictions. Do not treat SQL UAT as final financial acceptance.
4. Pass all cases above, with audit logs and authorized role/branch testing. GitHub Actions has an **ephemeral PostgreSQL 16 synthetic UAT** (`.github/workflows/recycling-postgres-uat.yml`) which executes the three draft SQL files, tests cash/credit VOID and Finance GL with fake data. This is not a substitute for Supabase staging, production-like RLS/device/session UAT or live printer tests.
5. Verify POS PR #492 and IT PR #217 together before a coordinated, limited Production rollout. Enable Recycling only after passing UAT, and deploy in a single planned batch where feasible.

Shop 155858 remains on its previously recorded CUSTOM trial settings until IT explicitly changes the mode. The General Sale login hotfix was merged via PR #493 and deployed to production, but Recycling itself remains disabled.
