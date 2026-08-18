# CpIPOS Performance Polling Handoff — 2026-08-19

Compact continuation point for the current request-churn hardening phase.

## Scope / safety boundary

- Repo: `sstdevelopaminno/CpIPOS`
- Branch: `agent-docs-preflight-schema-drift`
- Vercel production: `https://cp-ipos-web.vercel.app`
- Primary Supabase: `deejlitaivfnsbwqdugy`
- Trial Supabase: `kawenyvpentwgugtzqec`
- Do not change payment, Kitchen transaction, Print Agent claim/recovery, MDM, or idempotency semantics in this phase.
- Preserve live customer POS sessions; do not use MDM reload only for performance measurement.

## Recovery gates already in place

- Recovery regression test commit: `18328b2618d59cedee1ccb5abf8e75b82f2def15`
- Targeted command commit: `d40ffa4a1f77502864abb1c3c32f37463e35955a`
- Trial rollback-only recovery preflight commit: `ef0082ad7e22a65b0b32bb5ada6ef4b80acce405`
- Trial preflight passed live and rolled back cleanly.

## Production request baseline

One-hour Vercel request profile before/around phase 1:

- `/api/print-agent/v1/jobs/claim`: ~2,123/hour — intentionally excluded; verified Print Agent 1/2/3s recovery loop.
- `/api/pos/table-qr-activity`: initially ~466/hour; later rolling window ~414/hour.
- `/api/android-pos/update-policy`: ~158/hour — not current target.
- `/api/print-agent/v1/heartbeat`: ~152/hour — excluded.
- `/api/pos/session/current`: ~130/hour total across authenticated/unauthenticated clients.
- `/api/android-pos/mdm/heartbeat`: ~121/hour — excluded.
- customer `/api/table-order/...`: only ~2 requests/hour in the sampled window, so no honest customer P95/P99 claim is available yet.

## Phase 1 — global POS Table QR alert

Root cause:

`apps/backoffice-web/src/components/pos-preview/pos-table-qr-global-alert.tsx`

Old idle schedule:

- 3s -> 5s -> 10s -> 15s, then stayed at 15s.

Change commit:

- `12381fa8623f376366e5e94d1692ea310d216669`
- `perf(pos): back off idle table QR alert polling`

New idle schedule:

- 3s -> 5s -> 10s -> 15s -> 30s.
- fresh event resets to fast polling.
- focus / visible return performs immediate poll.
- single-flight dedupe remains.
- hidden tab pause remains.
- this is notification polling only; QR submit -> Order -> Kitchen is unchanged.

Vercel deployment for the performance commit:

- `dpl_9uhwL9MMdQ2eGyyGowuovGUSqN6j`
- Production READY, alias attached.

Main handoff checkpoint after phase 1:

- `170b6b01e3f981a50f1ef649b744d3c3431d9815`

### Live measurement caveat

After deployment, production still showed a stable ~15–16s request cadence. The requests route through the current server deployment, but an already-open Android WebView can keep executing the old JavaScript bundle until reload/navigation. The observed stream began immediately at the old 15s cadence rather than showing the new 5s -> 10s -> 15s warm-up pattern, so do not classify phase 1 as failed from those logs alone.

Do not force MDM/UI reload solely to obtain a performance metric. Measure again after a natural customer reload/navigation or during a safe test window.

## Database evidence — do not over-optimize SQL

Primary `public.table_qr_orders` currently has only 117 rows; FG0003 has 14 rows in the checked snapshot.

The activity query planner uses the existing table-session-created index and current estimated cost is tiny.

More importantly, `pg_stat_statements` showed the main `table_qr_orders` polling SELECT at:

- calls: `121,389`
- total execution time: ~`27,395.62 ms`
- mean execution time: ~`0.226 ms`

Conclusion: DB execution is not the bottleneck. Do not add a speculative index/cache for this poll now; optimize HTTP/serverless request count at the client layer.

## Customer Table QR audit

`apps/backoffice-web/src/components/table-order/table-order-mobile.tsx` already has:

- `MENU_STATUS_POLL_MS = 15_000`
- hidden-tab skip
- local in-flight guard
- immediate focus refresh
- immediate visible refresh
- existing post-submit refresh behavior

Do not re-implement those protections. A possible later cleanup is reducing effect/timer re-registration churn when the `menu` object changes, but there is not enough customer traffic in the sampled production window to justify a risky rewrite now.

## Polling regression guard

Added:

- `apps/backoffice-web/tests/integration/polling-request-churn-regression.integration.test.ts`
- commit `91a1f317d6553c814940f4d94e371df1252c9b80`
- message: `test(perf): lock adaptive polling request bounds`

It locks:

- global POS idle backoff reaches 30s
- global POS in-flight + hidden-tab + focus/visibility behavior remains
- customer Table QR polling remains 15s max visible cadence with in-flight + hidden-tab guards

## `/api/pos/session/current` audit so far

Production logs show:

- authenticated active POS requests roughly once per minute in the observed stream
- bursts of 401 requests came from unauthenticated/stale page clients on multiple deployments

Source callers identified:

- `PosEntryGate`: one session check during load/retry
- `PosSalesModule`: active-shift watchdog uses `/api/pos/session/current` with a 15s interval + focus check

Do not blindly slow the active-shift watchdog because it is a sales safety gate. First separate authenticated active-POS volume from unauthenticated page-load bursts and only consolidate if there is a clear duplicate caller.

## Next actions

1. Verify Vercel/CI for `91a1f317...`.
2. Re-measure `/api/pos/table-qr-activity` after a natural client reload; expect steady visible idle cadence to settle near 30s.
3. Do not add a DB index for this poll based on current evidence.
4. Inspect whether `/api/pos/session/current` has duplicate authenticated callers before any cadence change.
5. Keep Print Agent / MDM loops untouched in this phase.
