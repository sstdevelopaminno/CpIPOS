# CpiPOS Finance Dashboard · Completed sales and paid receipts (2026-11-17)

## Scope
This first Finance iteration is **read-only**, not an accounting ledger:
- Shared responsive dashboard rendered at `/preview/pos/finance` (Owner's existing POS session) and `/finance` (office Accountant's separate signed Finance session).
- Business and CUSTOM packages only. Explicit IT `main.finance` off always wins.
- Filter by **Bangkok date of payment completion** (inclusive day boundaries, up to 31 calendar days) and all permitted branches / one selected branch. Every filter is enforced on the server.
- Show completed bill total (`orders.grand_total`), separately from paid payment evidence (`payments.amount` where `status='paid'`), by currency, day, branch, and payment method; list the latest 50 completed orders and flag mismatches.
- THB/LAK/USD never combined. Legacy orders without a currency snapshot are THB as in the existing `pos-money` helper.
- Does **not** infer profit, expenses, tax liabilities, refund reconciliation, payment settlement or receivables.

## Security model
1. `actor=owner`: verify current POS session, **owner** role, active Finance package, and IT switch.
2. `actor=accountant`: verify purpose-separated Finance session. Every active branch must grant `accountant` in that tenant, package is checked each request, and IT switch is enforced.
3. Server supplies `tenantId` and allowed active branch IDs. The browser may request only a branch inside this verified set. No cross-tenant IDs or role grants may be supplied by URL.
4. Service-role Supabase queries explicitly constrain `tenant_id`, `branch_id`, `status`, and a bounded date interval; errors fail closed.
5. GET-only route, private no-store response; no SQL migrations, writes to orders/payments, ledger posting, backdated invoice operations, or new POS privileges.

## Data semantics
- Completed order is **counted exactly once** using its payment-completion timestamp in `Asia/Bangkok`. Exclude queued/cancelled statuses.
- `orders.grand_total` is the successful bill total, *not* the same thing as the sum of recorded payments. This corrects for mixed/partial payments and avoids double counting.
- `payments.status='paid'` rows linked to completed orders provide paid evidence. Ignore pending rows; dedupe by payment UUID.
- `payments` are grouped by the original order currency, never converted or summed with another currency.
- Mismatched bill/payment totals are marked for verification, not silently fixed. No claims about taxable revenue or profit.
- If a date range has 3,000+ completed orders, the service fails closed asking for a narrower period rather than reporting truncated or misleading totals.

## Known boundaries / next iteration
- Payment adjustments, refunds, and cost accounting need a separate audited reconciliation ledger and source-of-truth review.
- A sale's payment-completion date is the report's date basis. Bank settlement date may differ.
- UI is operational read-only Finance; do not use as a tax invoice, official accounting book, cash reconciliation confirmation, or financial statement.
- Browser E2E should verify authorized Owner and Accountant roles, cross-tenant denial, revocation and direct API access before Production rollout.
- No changes to user roles, package billing, customer records, or migrations are made in this development branch.
