# CpIPOS POS: Phase-1 Subscription Center (A+B)

Source of truth is the EXISTING Supabase CpiPOS-001. The IT payment-operations spec and IT routes are maintained separately in `sstdevelopaminno/CpIPOS-IT` PR #55; this POS PR is #192.

The Windows/web POS subscription screen at `/preview/pos/payments` used to show an oversized LINE contact QR, zero-priced internal CUSTOM package and sentinel limits `999999`. It is now an actual read/submit customer experience with:
- Blue package header: real store/package/status/term.
- Expiry and days remaining, cycle charge, quotas shown as "ไม่จำกัด" for sentinel values.
- Tabs: overview / renewal / report transfer+slip / history / documents.
- Right rail: *company* receiving account and Support, LINE QR clearly contact only.
- Explicit separation from cashier payment routes and sales/shift totals.
- Owner-only submission, manager read-only; no feature sale:create gate to hide the renewal page after expiry.

`GET /api/pos/billing/overview` verifies session scope and reads the primary billing tables. `POST /api/pos/billing/requests` accepts multipart, validates server-side available plan/month/year, reports an amount as customer-reported only, and uploads up to 4 MiB evidence privately, never as a public URL. An intent can omit proof; a payment notice requires proof, receiving account and positive amount. A stable UUID request key prevents network retry duplicates and a DB partial unique index limits one open request per store.

The IT's private evidence bucket and single-open-request index already exist in the SAME CpiPOS-001; they are versioned in the separate IT PR #55. Do not create a new Supabase, Vercel or GitHub project to release this UI.

## Rollout blockers

- CI green on both repo PRs, correct existing Vercel project linkage/preview URL confirmed.
- Test store owner and IT administrator end-to-end with private JPG/PDF slip; compare UI values to existing contract/lifecycle before merging.
- Never call legacy 30-day subscription approval RPC for annual plans; bank-confirmation/atomic settle and issuance of immutable document numbers remain the next phase.
- No automatic receipt, tax invoice, or email dispatch in this PR. Await authorized bank feed and user's distinct quotation/receipt PDF reference.

Regression boundary: no modifications to `/api/pos/payments`, `orders`, `order_items`, `payments`, `shifts`, shift-close totals or receipt printer.
