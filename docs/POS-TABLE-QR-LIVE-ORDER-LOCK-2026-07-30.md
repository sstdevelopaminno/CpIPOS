# POS Table QR Live Order And Payment Lock 2026-07-30

## Scope

Fixes dine-in table QR ordering visibility and checkout safety:

- POS table selection now receives QR activity summary from `/api/pos/tables`.
- Table list and floor plan show a red QR activity dot plus item/status badge when a table has a latest QR order/service event.
- POS stores the latest seen QR event per table in local storage key `pos_table_qr_activity_seen_v001`; opening the table clears the dot on that terminal, and a newer QR event shows it again.
- Selecting a table with unseen QR activity forces a fresh bill load instead of trusting stale prefetch cache.
- Table selection polls `/api/pos/tables` every 5 seconds while visible, so staff do not need to repeatedly open tables to discover customer QR orders.

## Payment Lock Behavior

- New route: `POST /api/pos/tables/[tableId]/payment-lock`.
- The route sets active table bill status and dining table status to `pending_payment` when staff open payment review/cash/transfer flow.
- Closing review/cash/transfer before successful payment unlocks the table back to `ordering`.
- Successful payment still uses the existing `/api/pos/payments` close flow.
- No schema migration was added.

## Customer QR Behavior

- `/api/table-order/[token]` GET still loads during `pending_payment` so customers can see their submitted order summary.
- The QR response returns `can_order: false`, `bill_status`, and `submitted_summary` during payment lock.
- Customer QR page shows submitted item count, order lines, and total amount from the server-side order/bill.
- Customer QR POST order/service requests are blocked server-side when the table bill is `pending_payment`, preventing accidental extra orders during checkout.

## Verification

Run on 2026-07-30:

- `pnpm --filter backoffice-web typecheck`: passed.
- `pnpm --filter backoffice-web test`: passed, 30 files / 75 tests.
- Targeted ESLint for touched API/service/component files: passed.
- `pnpm --filter backoffice-web lint`: passed.
- `pnpm schema:drift`: passed.
- `pnpm --filter backoffice-web build`: passed; route list includes `/api/pos/tables/[tableId]/payment-lock`.