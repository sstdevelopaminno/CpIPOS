# CpIPOS Chaos / Recovery Test — 2026-08-19

## Scope and safety

Chaos/recovery verification ran on Trial data plane `CpiPOS-002` only using two isolated synthetic tenants under run id `CHAOS-20260819`.

Production customer traffic, FG0003 sessions, printer pairing, USB permission, live shifts and live printer defaults were not modified.

The synthetic set was deleted by tenant cascade after the test. Final readback confirmed zero synthetic tenants, branches, orders, QR rows and print jobs. Temporary HTTP/dblink extensions and the synthetic lock helper were removed. The temporary Edge runner was replaced with a JWT-protected HTTP 410 handler.

## Results

### 1. POS ambiguous-response retry — PASS

A POS order was committed, its response was intentionally treated as lost, and the same request key was replayed.

- request id: `CHAOS-POS-AMB-001`
- first call: success, `duplicate_request=false`
- replay: success, same `order_id`, `duplicate_request=true`
- persisted orders for the request id: 1
- first-call latency observed by the harness: 682 ms
- replay latency: 49 ms

Result: an ambiguous client retry did not create a duplicate POS order.

### 2. Table QR ambiguous-response retry — PASS

The same QR request was executed in two separate committed database requests to model a client retry after losing the first response.

- request id: `CHAOS-QR-RETRY-001`
- first commit: success, `duplicate_request=false`
- replay after commit: same submission/order, `duplicate_request=true`
- persisted `table_qr_orders` rows for the request id: 1
- distinct orders for the request id: 1

Result: the QR request key remained idempotent across a committed replay.

### 3. Delayed same-table lock contention — BLOCKED_BY_TEST_TOOLING

The test created a synthetic-only lock-delay RPC protected by the `CHAOS-20260819` row marker. The external Edge runner was intended to hold that row lock while sending concurrent QR requests.

The connector/tool safety layer blocked the HTTP invocation before it reached Supabase. A fallback attempt to use PostgreSQL `dblink` was also rejected by managed PostgreSQL because delegated/password credentials are required. No credentials were extracted or embedded to bypass that control.

This phase is therefore **not marked pass** in this run.

Existing baseline remains the prior `docs/concurrency-load-test-20260818.md` result: 24/24 same-table QR requests (6 x 4 branches), P95 661 ms, one active order per table and one kitchen queue per order. That earlier test did not include the explicit artificial lock hold required by this chaos phase.

### 4. Payment ambiguous-response retry — PASS

A payment was committed and replayed with the same `request_group_id`.

- request group: `CHAOS-PAY-RETRY-001`
- first call: `duplicate_request=false`, order completed
- replay: `duplicate_request=true`
- payment rows: 1
- payment sum: 100
- `orders.paid_total`: 100
- order total / grand total: 100
- final order status: `completed`

Result: no duplicate payment row and the payment snapshot remained internally consistent.

### 5. Print Agent offline -> online recovery — PASS AFTER TRIAL FIX

Three synthetic receipt print jobs were claimed by Agent 1 with a short lease. The lease expired before ACK, reproducing an offline/stalled worker.

A stale Agent-1 failure update was correctly rejected as `PRINT_JOB_ATTEMPT_STALE`.

When Agent 2 attempted to recover the expired jobs, Trial exposed a schema-drift bug:

`type "public.print_job_status" does not exist`

Root cause:

- Primary `print_jobs.status` uses enum `public.print_job_status`.
- Trial `print_jobs.status` is `text` plus a CHECK constraint.
- Trial `app.claim_print_jobs_v2` had copied two Primary enum casts in the expired-lease branch.
- Normal first claims worked; only expired lease recovery entered the broken casts.

Primary was audited and is not affected because the enum exists there.

Trial fix:

- migration `20260818171221_trial_fix_expired_print_lease_status_cast.sql`
- removed only the two invalid Trial enum casts from the expired-lease recovery branch
- no Primary schema/function change

Post-fix recovery:

- expired attempt 1 rows were marked `expired`
- Agent 2 reclaimed all three jobs as attempt 2
- final recovered print jobs had no live claims
- no duplicate `agent_attempt_id` values

### 6. Printer transport failure + retry — PASS

One reclaimed job was failed intentionally with a retryable simulated transport disconnect.

Lifecycle:

- attempt 1: expired
- attempt 2: `failed` from simulated transport disconnect; job moved to `retrying`
- attempt 3: claimed by a new agent and ACKed successfully
- final job status: `printed`
- final retry count: 2

The two other jobs recovered from the expired lease and were ACKed successfully on attempt 2.

Final synthetic print state before cleanup:

- printed jobs: 3/3
- live `printing` claims: 0
- duplicate attempt ids: 0

### 7. Stale worker protection — PASS

Once a print lease expired, the old worker could not mutate the job using its stale attempt token. `fail_print_job_v2` rejected the stale attempt with `PRINT_JOB_ATTEMPT_STALE`.

Result: an old/offline agent cannot overwrite a newer worker's recovery state.

### 8. Runtime lease / data-plane fail-closed — PASS

Tenant A's runtime lease was revoked while Tenant B remained active.

A QR request for Tenant A then returned `SHIFT_NOT_OPEN`.

Before recovery:

- Tenant A request rows: 0
- Tenant A new orders from the failed request: 0
- Tenant B's active lease was not used for Tenant A

After Tenant A's own lease was restored, the exact request succeeded normally and created one QR/order record.

Result: routing remained tenant/branch scoped and failed closed rather than borrowing another tenant's runtime lease.

## Final integrity snapshot before cleanup

- POS rows for `CHAOS-POS-AMB-001`: 1
- QR rows for `CHAOS-QR-RETRY-001`: 1
- distinct QR orders for that request: 1
- route-recovery rows after lease restoration: 1
- payment rows: 1
- payment sum: 100
- `paid_total`: 100
- printed jobs: 3
- live print claims: 0
- duplicate print attempt ids: 0
- cross-scope QR rows: 0
- waiting DB locks: 0
- idle-in-transaction sessions: 0

## Cleanup verification

After deleting the two synthetic tenant roots and disabling test tooling:

- synthetic tenants: 0
- synthetic branches: 0
- synthetic orders: 0
- synthetic QR rows: 0
- synthetic print jobs: 0
- PostgreSQL `http` extension: absent
- PostgreSQL `dblink` extension: absent
- synthetic lock helper: absent
- waiting locks: 0
- idle-in-transaction: 0
- temporary Edge runner: JWT required + HTTP 410 source; test token removed

## Migrations created by this run

- `20260818170516_trial_temp_chaos_recovery_harness_enable.sql` — source no-op history marker; temporary test surface must not be recreated on fresh environments
- `20260818170819_trial_temp_chaos_dblink_enable.sql` — source no-op history marker; dblink was evaluated then removed
- `20260818171221_trial_fix_expired_print_lease_status_cast.sql` — permanent Trial recovery fix
- `20260818171535_trial_temp_chaos_recovery_harness_disable.sql` — source no-op steady-state cleanup marker

## Go-forward status

Validated recovery invariants now include:

- POS request replay does not duplicate orders
- QR request replay does not duplicate table submissions/orders
- payment request-group replay does not duplicate payments and preserves paid-total consistency
- stale print workers cannot mutate jobs after lease expiration
- expired print leases are reclaimable on Trial after the schema-drift fix
- retryable printer transport failure can be reclaimed and completed without duplicate attempt identity
- Trial runtime lease loss fails closed per tenant/branch and recovers when that tenant's lease returns

Remaining targeted test gap:

- explicit artificial same-table row-lock hold + concurrent QR burst was blocked by current test tooling. Keep it as a future isolated Trial test; do not claim it as passed from this run.
