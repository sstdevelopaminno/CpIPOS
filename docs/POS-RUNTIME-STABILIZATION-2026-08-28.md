# POS Runtime Stabilization — 2026-08-28

## Scope

This stabilization slice is stacked on the SD / General Sale feature head and is intentionally limited to software-side runtime performance and embedded printing safeguards.

## Runtime load hardening

- `/api/pos/monitor` keeps authorization fresh but coalesces expensive branch-level monitor aggregation behind a 30-second runtime cache.
- `/api/pos/session/current` keeps POS session, active shift lookup, and device policy checks fresh while coalescing only order/payment shift metrics for 5 seconds per tenant + branch + shift.
- The short metrics cache is observational only. Order creation, payment, stock deduction, shift mutation, and receipt/print queue writes remain server-authoritative and uncached.
- Existing POS monitor, Table QR, and cash-drawer readiness polling remains visibility-aware and protected against overlapping requests.

## Android embedded printing

- `PosPrintAgent` remains embedded in the Android POS process.
- Idle claims keep the bounded adaptive `1 -> 3 -> 8s` cadence with a separate 45-second heartbeat.
- Queue-producing POS actions invoke the native JavaScript bridge and wake the agent immediately, with a 350ms follow-up claim.
- A queue wake now clears a pre-login bootstrap authentication cooldown. This prevents the first post-login receipt from waiting for the previous bootstrap retry window while avoiding continuous unauthenticated polling.

## Windows embedded printing

- The native Windows POS runtime owns `LocalPrintBridge` for the lifetime of the application process.
- The bridge binds only to `127.0.0.1`, serializes printer/drawer operations, limits concurrent local requests, and continues its accept loop after transient listener errors.
- A PR validation workflow compiles the Windows native runtime so embedded bridge regressions are caught before release.

## Validation checkpoint

PR #146 is temporarily retargeted to the CI-enabled integration branch only to validate the exact stabilization head. After CI, Android, Windows, and Vercel Preview checks complete, the PR base must be restored to `feature/grocery-mode-pos-sales-20260827` so the diff stays stabilization-only.

## Release boundary

Software validation does not replace physical printer acceptance. Issue #74 remains the production release gate until a real dedicated kitchen-capable profile/device is validated end-to-end. This slice must not mutate production printer assignments, requeue historical jobs, or be promoted solely from CI/Preview evidence.
