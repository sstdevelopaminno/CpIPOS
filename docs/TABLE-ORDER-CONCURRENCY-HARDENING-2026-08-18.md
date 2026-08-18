# Table Order Concurrency & Payment Hardening — 2026-08-18

## Scope

Production hardening for simultaneous dine-in/Table QR ordering across many tables and tenant/branch scopes. Changes are intentionally limited to order-vs-checkout serialization, payment-lock consistency, payment idempotency, recipe-stock atomicity, and Primary/Trial data-plane parity.

## Production evidence before the change

- Vercel review showed no `/api/pos/sales` 5xx in the latest 6-hour window at inspection time; the preceding 24-hour window contained 13 `/api/pos/sales` 5xx responses, including one ~30 second 504.
- `pg_stat_statements` showed Table QR submit at about 189 ms mean across 83 calls (max about 3.1 s), and POS create-order at about 319 ms mean across 74 calls (max about 1.28 s).
- Table QR already used QR/table-session row locks, not one global store-wide lock.
- `table_qr_sessions.table_session_id` is unique, preventing duplicate QR-session ownership for the same bill session.

## Correctness issues found

1. HTTP precheck rejected `pending_payment`, but the database Table QR transaction still accepted it, leaving a checkout race window.
2. `payment-lock` updated `table_bill_sessions` and `dining_tables` in separate statements, allowing short-lived state divergence.
3. On Primary, Table QR stock was checked at submit but actual recipe deduction fallback could run only after payment committed.
4. A completed order could reach a second payment attempt under a fresh request key during a race.
5. The new payment-lock RPC needed explicit tenant data-plane selection so future Trial-routed tenants do not invoke it against Primary by default.
6. The first append guard checked bill-session state without taking a row lock; a direct/fallback item-insert path could theoretically observe stale `ordering` while checkout was committing.

## Primary / CpiPOS-001 changes

### `20260818053044_table_order_concurrency_payment_lock_hardening.sql`

- Adds `trg_order_items_guard_table_bill_append` to reject new order items when the table session is `pending_payment` or closed.
- Adds service-role-only `set_table_payment_lock_tx`.
- Uses deterministic lock order: bill session -> dining table -> order.
- Updates bill-session and dining-table payment state atomically.
- Adds a 5-second database lock timeout so contention fails fast instead of hanging indefinitely.

### `20260818053920_table_qr_payment_stock_atomicity.sql`

- Locks the order before payment/idempotency decisions.
- Same request-group retries return the existing payment result.
- Fresh-key payment attempts on an already completed order are rejected.
- For `channel=table_qr`, recipe stock deduction runs inside the same transaction before payment insertion/order completion when no prior sale-deduction movement exists.
- Insufficient stock rolls back stock, payment, and order completion together.
- Existing POS orders that already have sale-deduction movements are not deducted again.
- FG0003 free topping recipe rows use `quantity_per_item=0`; shared recipe stock deduction ignores those rows.

### `20260818055551_table_order_item_guard_row_lock_hardening.sql`

- Upgrades the append guard to take `FOR SHARE` on the matching bill-session row.
- The guard now serializes every table-bill item insert with checkout state changes, including direct/fallback insert paths.
- Adds a 5-second lock timeout to avoid indefinite waits under contention.

## Trial / CpiPOS-002 parity

### `20260818054729_trial_table_order_concurrency_payment_lock_hardening.sql`

- Mirrors the table-session append guard and atomic payment-lock transaction on Trial.
- Keeps the same per-table lock order and service-role-only execution model.

### `20260818054924_trial_payment_idempotency_hardening.sql`

- Preserves Trial runtime-lease enforcement and request-key advisory locking.
- Adds order-row locking and rejects a fresh payment request after the order is already completed.
- Trial Table QR submit already performs recipe-stock updates and stock movements within its submit transaction, so the Primary stock-at-payment workaround is intentionally not duplicated on Trial.

### `20260818055603_trial_table_order_item_guard_row_lock_hardening.sql`

- Mirrors the final `FOR SHARE` append-guard serialization and 5-second lock timeout on Trial.

## API/data-plane routing

`apps/backoffice-web/src/app/api/pos/tables/[tableId]/payment-lock/route.ts` calls the atomic `set_table_payment_lock_tx` RPC with explicit tenant, branch, table, and order scope.

`apps/backoffice-web/src/lib/tenant-data-router.ts` includes `set_table_payment_lock_tx` in the routed business RPC set. The router:
- reads authoritative lifecycle state from Primary control plane;
- uses Primary for `data_home=primary`;
- fails closed for archived tenants;
- uses Trial only when Trial routing is explicitly enabled;
- prevents a future Trial tenant from silently invoking this business mutation against the wrong database.

Routing-contract tests cover both Primary routing and Trial concurrency parity.

At verification time, all currently active tenant lifecycle rows were still `data_home=primary`; Trial parity was added proactively so moving a tenant later does not reintroduce the race.

## Concurrency invariants after hardening

- Same table: Table QR submit, direct item append, and payment-lock serialize on the same bill-session row.
- Different tables in the same branch: independent row locks; no branch-wide mutex.
- Different stores/tenants: tenant/branch predicates isolate data and locks.
- QR submit retry: existing request-id idempotency remains authoritative.
- Payment retry with the same request group: returns the existing result.
- Payment retry with a different request group after completion: rejected.
- Primary Table QR recipe stock: atomic with payment.
- Trial Table QR recipe stock: atomic with submit by Trial's existing transaction.

## Verification completed

- Primary and Trial migration readback: SECURITY DEFINER functions use explicit `search_path`; privileged RPC execution is service-role-only.
- Primary and Trial payment/payment-lock functions use row-level serialization; payment/payment-lock and append guards use a 5-second database lock timeout.
- Safe invalid-scope RPC smoke tests passed without creating fake orders/payments.
- Closed-session `order_items` insert smoke test was correctly rejected with `TABLE_SESSION_CLOSED` and left no row behind.
- Existing completed Table QR payment retried with its original request key returned `duplicate_request=true` and the original total.
- The same completed order with a new synthetic key was rejected and created zero payment rows.
- Production Next.js build/TypeScript completed successfully on Vercel for the routing fix.
- Production deployment for the routing/test commit reached READY.
- Database lock inspection found no waiting locks during verification.

## Load-test policy

No destructive high-volume fake paid-order load was generated against production. Stability conclusions use production telemetry, lock/index/function inspection, transaction invariants, safe no-write/error-path smoke tests, and deployment/runtime checks. A high-concurrency synthetic benchmark should run against a staging/trial dataset with production-equivalent schema and representative recipe/menu cardinality.
