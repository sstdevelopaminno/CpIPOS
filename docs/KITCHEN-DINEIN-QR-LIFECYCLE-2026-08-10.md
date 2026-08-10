# CpIPOS Kitchen / Dine-in / Table QR lifecycle — 2026-08-10

## Scope

This checkpoint extends the existing Kitchen Core. It does not replace the existing POS or Table QR transaction model.

Existing `order_items` database triggers remain responsible for dispatching newly inserted POS/Table QR items into Kitchen tickets. POS dine-in edits continue through `replace_queued_dine_in_order_tx`, including its additive `kitchen_delta_quantity` behavior.

## Required lifecycle

For Kitchen Display enabled zones, each Kitchen item follows:

```text
queued -> accepted -> ready
```

- `queued`: cashier may still edit/remove/decrease the dine-in order item through the existing authoritative dine-in transaction.
- `accepted`: Kitchen has pressed `รับออเดอร์`; cashier may no longer change product/notes/price, delete, or decrease quantity.
- Increasing quantity remains allowed. The existing dine-in transaction emits an additive Kitchen batch, shown as `เพิ่มรายการอาหาร`.
- `ready`: Kitchen has pressed `พร้อมเสิร์ฟ`; the item disappears from the active KDS list.
- cancelled Kitchen deltas are terminal and are not displayed as work to cook.

The lock is enforced at the database boundary for dine-in `order_items`, not only in the browser.

## POS and customer Table QR

- POS and customer Table QR order-item inserts are dispatched by the existing Kitchen order-item trigger.
- Tickets are grouped on the KDS by `table_id`.
- Later batches for the same open table appear below the current batch as `เพิ่มรายการอาหาร`.
- Table QR customer submissions remain immutable from the customer surface after submit.
- POS edits are allowed only until the relevant KDS-enabled Kitchen work has been accepted; after acceptance, only quantity increases are allowed.

## KDS ticket board

The Kitchen page is a horizontal ticket board.

Each ticket/table group shows:

- table code/name when available;
- order number;
- Kitchen zone;
- branch-local running Kitchen queue number;
- Bangkok date/time and elapsed age;
- food items with item-level `รับออเดอร์` / `พร้อมเสิร์ฟ` actions.

Red means no item in that table group has been cleared to ready yet. Orange means at least one item has been cleared while other Kitchen work remains. Once all KDS-required work is ready/cancelled, the group disappears from the active board.

## Running queue

`kitchen_tickets.queue_no` is assigned per tenant + branch + Bangkok business date. Tickets generated for multiple Kitchen zones from the same Kitchen event share the same queue number. Assignment is serialized with a transaction advisory lock to avoid duplicate queue allocation under concurrency.

## Dine-in payment/clear gate

A dine-in order may not transition to `completed` while any item in a KDS-enabled Kitchen zone remains `queued` or `accepted`.

The final guard is a database trigger on the order completion transition so normal POS payment paths cannot bypass the rule by changing client UI behavior.

## No-KDS zone exception

`kitchen_zones.kds_enabled` controls whether a Kitchen zone participates in the screen workflow.

When `kds_enabled=false`:

- the zone does not appear on Kitchen Display;
- its Kitchen work does not lock cashier edits through the KDS acceptance rule;
- its Kitchen work does not block dine-in payment/clear;
- existing Kitchen routing/printing may still be used.

Owner/Manager can change this flag from `/preview/pos/kitchen/settings`. This is a server-authorized branch-scoped setting; the cashier/customer client cannot submit a bypass flag.

Categories/products inherit this behavior through the existing Kitchen routing rules that route them to a zone.

## Data-plane / security rules

- Every Kitchen read/write remains tenant + branch scoped.
- Business-table operations use the existing routed Supabase service client so Primary/Trial routing remains server-controlled.
- No browser selects a data plane or supplies trusted tenant/branch scope.
- Primary and Trial source migrations are mirrored.
- No live migration is applied by this source-development checkpoint.

## Source migration

Primary:

`supabase/migrations/20260810220000_kitchen_item_lifecycle_and_payment_gate.sql`

Trial mirror:

`supabase/trial-data-plane/migrations/20260810220000_trial_kitchen_item_lifecycle_and_payment_gate.sql`

These files are source-only until an explicit controlled migration rollout is approved and verified.

## Validation gates before merge/deploy

1. Typecheck.
2. Lint.
3. Integration tests including Kitchen lifecycle source contracts.
4. Primary and Trial schema drift gates.
5. Backoffice production build.
6. Controlled migration review/apply to Primary and Trial only after explicit approval.
7. End-to-end test: POS dine-in submit -> KDS -> accept -> POS decrease/delete rejected -> POS increase creates added batch -> ready -> payment succeeds.
8. End-to-end test: Table QR submit -> KDS -> added same-table QR batch -> ready -> payment succeeds.
9. Verify `kds_enabled=false` zone does not appear on KDS and does not block checkout.

Do not merge/deploy this work until the source and migration gates are green and rollout is explicitly approved.
