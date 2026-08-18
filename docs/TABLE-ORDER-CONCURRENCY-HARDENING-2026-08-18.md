# Table Order Concurrency & Payment Hardening — 2026-08-18

## Scope

Production hardening for simultaneous dine-in/Table QR ordering across multiple tables and multiple tenant/branch scopes. The changes are intentionally narrow: table-order acceptance vs checkout, payment-lock consistency, payment idempotency, and Table QR recipe-stock atomicity.

## Production evidence before the change

- Latest 6-hour Vercel review showed no `/api/pos/sales` 5xx at the time of inspection.
- Previous 24-hour review showed 13 `/api/pos/sales` 5xx responses, including one ~30 second 504.
- `pg_stat_statements` showed the Table QR submit RPC around 189 ms mean across 83 calls (max about 3.1 s), and POS create-order transaction around 319 ms mean across 74 calls (max about 1.28 s).
- QR/table-session locking was already row-scoped rather than global; different tables and different stores do not share a single global lock.
- `table_qr_sessions.table_session_id` is unique, preventing duplicate active QR-session records for one bill session.

## Correctness issues found

1. The HTTP/Table QR precheck rejected `pending_payment`, but the database Table QR RPC still accepted it. This left a race where a QR order could continue after checkout had started.
2. `payment-lock` updated `table_bill_sessions` and `dining_tables` in two separate statements/transactions, leaving a short inconsistent-state window.
3. Table QR stock availability was checked before submit, while actual recipe stock fallback ran after payment completion. If stock became insufficient, payment could already have committed before the stock fallback returned an error.
4. Payment completion did not reject a second payment with a different request key once the order was already completed. The unique request-group index protects the same key, but not a fresh key.

## Changes

### Migration `20260818053044_table_order_concurrency_payment_lock_hardening.sql`

- Adds `trg_order_items_guard_table_bill_append` so new order items are rejected when the matching table bill session is `pending_payment` or closed.
- Adds service-role-only `set_table_payment_lock_tx`.
- Locks in deterministic order: bill session -> dining table -> order.
- Updates bill-session and dining-table state atomically.
- Uses a 5-second DB lock timeout so contention fails fast instead of hanging indefinitely.

### Migration `20260818053920_table_qr_payment_stock_atomicity.sql`

- Locks the target order before payment/idempotency decisions.
- Re-checks the request group after the row lock.
- Rejects payment when the order is already paid/completed, even with a new request key.
- For `channel=table_qr`, recipe stock deduction now runs inside the same DB transaction before payment rows/order completion if the order has no existing sale-deduction movement.
- Insufficient recipe stock rolls back stock, payment, and order completion together.
- Existing POS orders that already deducted stock at order creation are not deducted again.
- FG0003 free topping recipe rows have `quantity_per_item=0`; the shared recipe deduction ignores them, so this hardening does not consume free topping quantities.

### API

`apps/backoffice-web/src/app/api/pos/tables/[tableId]/payment-lock/route.ts` now calls the atomic `set_table_payment_lock_tx` RPC rather than issuing two independent updates. Lock timeout/deadlock states map to a retryable 409 response.

## Concurrency invariants

- Same table: QR submit and payment-lock serialize on the same bill-session row.
- Different tables in the same branch: independent row locks; no branch-wide mutex.
- Different tenants/stores: tenant/branch-scoped rows and RPC predicates; no cross-tenant lock or mutable scope from the client.
- QR retry: existing request-id idempotency remains authoritative.
- Payment retry with the same request group: returns the existing payment result after acquiring the order lock.
- Payment retry with a different request group after completion: rejected.
- Table QR stock deduction: atomic with payment for recipe-deduction products.

## Verification policy

Production verification uses schema/function readback, permission checks, query/runtime telemetry, build/CI status, and post-deploy error logs. Do not create large volumes of fake paid orders in production for a synthetic load test. A destructive load benchmark should run in a staging/trial dataset with production-equivalent schema and representative menu/recipe cardinality.
