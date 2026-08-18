# CpIPOS Multi-Tenant Concurrency Load Test — 2026-08-18

## Scope

Trial data plane only (`CpiPOS-002`). The workload used isolated synthetic tenants and branches and was cleaned up after the run.

Test model:

- 2 synthetic tenants
- 4 branches (2 per tenant)
- 10 tables per branch / 40 tables total
- POS and Table QR transaction paths
- Kitchen Ticket trigger/routing path
- request idempotency
- same-table serialization
- per-order kitchen queue consistency
- Print Agent claim concurrency

No production customer data was used for the load generation.

## Final measured results

| Phase | Concurrent operations | Success | P50 | P95 | P99 / max |
|---|---:|---:|---:|---:|---:|
| POS burst | 10 | 10/10 | 290 ms | 344 ms | 344 ms |
| POS burst | 25 | 25/25 | 443 ms | 645 ms | 647 ms |
| POS burst | 50 | 50/50 | 639 ms | 1,144 ms | 1,146 ms |
| QR distinct tables | 32 | 32/32 | 915 ms | 1,230 ms | 1,238 ms |
| QR same-table burst | 24 (6 × 4 branches) | 24/24 | 538 ms | 661 ms | 673 ms |
| QR idempotency replay | 8 | 8/8 | 239 ms | 259 ms | 259 ms |
| POS idempotency replay | 8 | 8/8 | 182 ms | 221 ms | 221 ms |

The final integrity snapshot after the QR rerun contained:

- 129 orders
- 149 order items
- 60 QR submissions
- 149 Kitchen Tickets
- 149 Kitchen Ticket Items
- 0 cross-tenant/branch order items
- 0 cross-tenant/branch Kitchen Tickets
- 0 cross-scope Kitchen Ticket Items
- 0 duplicate POS request groups
- 0 duplicate QR request groups
- 0 duplicate active table bills
- 0 Kitchen Tickets missing a table snapshot
- 0 orders with multiple kitchen queue numbers
- 0 queue numbers shared by multiple orders in the same branch
- 0 waiting DB locks after the test
- 0 idle-in-transaction sessions after the test

Same-table concurrency produced exactly one order per table. Each tested same-table order had six Kitchen Ticket rounds with the expected lifecycle:

`round 1 = new`, followed by `rounds 2–6 = add`, all retaining one queue number for the lifetime of the order.

## Print claim race

The Print Agent claim path was raced with four synthetic agents per branch. Two branches completed through the external test runner before connector safety blocked further test invocations:

- branch T1-B1: 39 jobs, 39 unique claims, 0 duplicate job claims, P95 claim call 489 ms
- branch T1-B2: 38 jobs, 38 unique claims, 0 duplicate job claims, P95 claim call 289 ms

Database readback across these 77 jobs found:

- 77 jobs in `printing`
- 0 jobs with more than one live claim
- 0 duplicate `agent_attempt_id` groups

The connector blocked the two T2-specific runner invocations before they reached Supabase. This was a tooling limitation, not an application/database failure. Multi-tenant order, QR, Kitchen Ticket, and queue isolation were exercised across both tenants and all four branches.

## Defects found and fixed by the test

### 1. Trial `enqueue_kitchen_order` output-column ambiguity

The Trial function used an unqualified `RETURNING id, queue_no, round_no` even though `queue_no` and `round_no` were also `RETURNS TABLE` output variables. Concurrent POS creation exposed PostgreSQL error `42702`.

Fix: qualify the INSERT target as `inserted_ticket` and use `RETURNING inserted_ticket.id, inserted_ticket.queue_no, inserted_ticket.round_no`.

Migration: `20260818161433_trial_fix_kitchen_returning_queue_ambiguity.sql`.

### 2. Trial Kitchen Ticket Item conflict ambiguity

The Trial function used column inference in `ON CONFLICT (kitchen_ticket_id, order_item_id, action)`, which conflicted with a PL/pgSQL output variable.

Fix: use the named unique constraint.

Migration: `20260818161506_trial_fix_kitchen_ticket_item_conflict_ambiguity.sql`.

### 3. Kitchen queue changed across ADD rounds

Both Primary and Trial loaded the existing order queue correctly, but a subsequent event-key lookup selected `queue_no` into the same variable. A miss on a new event key set the variable to `NULL`, causing the queue trigger to allocate a new number for each ADD round.

Fix: event/reprint lookup no longer overwrites the existing order queue. The post-INSERT fallback still reads the persisted queue when needed.

Migrations:

- Primary: `20260818162125_preserve_order_kitchen_queue_across_rounds.sql`
- Trial: `20260818162109_trial_preserve_order_kitchen_queue_across_rounds.sql`

The post-fix QR rerun confirmed `orders_multiple_queue_numbers = 0` and `queue_shared_by_multiple_orders = 0`.

### 4. Trial composite FK could not clean up an order

Trial used a composite FK `(tenant_id, branch_id, order_id) -> orders(...) ON DELETE SET NULL`. PostgreSQL attempted to null all referencing columns, including non-null tenant/branch scope columns.

Fix: keep the composite scoped FK but use selective `ON DELETE SET NULL (order_id)`.

Migration: `20260818162243_trial_table_bill_order_fk_selective_set_null.sql`.

Primary was already safe because its table-bill relation uses a simple `order_id` FK.

## Cleanup

After collecting results:

- all synthetic tenants, branches, leases, products, tables, sessions, orders, tickets and print jobs were deleted by synthetic tenant cascade
- all synthetic row counts read back as zero
- the temporary Trial `http` extension was removed
- temporary Edge load functions were replaced with JWT-protected HTTP 410 handlers
- the load-test token was removed from active function source

Migration-history markers retain the temporary Trial HTTP step without enabling the extension in fresh environments.

## Go-forward baseline

For the current transaction and routing implementation, this run establishes a validated baseline of:

- 50 simultaneous POS order transactions with 0 failures and P95 ~1.14 s
- 32 simultaneous QR submissions on different tables with 0 failures and P95 ~1.23 s
- 6 simultaneous QR submissions to the same table per branch, across 4 branches, with correct serialization and P95 ~0.66 s
- no observed tenant/branch/table data crossover or request duplication
- stable per-order Kitchen queue identity across new/add rounds

Future concurrency changes should rerun this matrix on Trial before promotion to Production.
