# CpIPOS Current Handoff — 2026-08-19

This file is the compact recovery point if the ChatGPT conversation rolls over.

## Environment

- Repo: `sstdevelopaminno/CpIPOS`
- Branch: `agent-docs-preflight-schema-drift`
- Primary Supabase: `CpiPOS-001` (`deejlitaivfnsbwqdugy`)
- Trial Supabase: `CpiPOS-002` (`kawenyvpentwgugtzqec`)
- Vercel project: `cp-ipos-web`
- Production alias: `https://cp-ipos-web.vercel.app`

Read first:

1. `docs/AI-GUARDRAILS-CPIPOS.md`
2. `context.md`
3. `docs/concurrency-load-test-20260818.md`
4. `docs/chaos-recovery-test-20260819.md`

## Completed baseline

### Concurrency

`docs/concurrency-load-test-20260818.md`

- POS 50 concurrent: 50/50, P95 1.144 s
- QR distinct 32 concurrent: 32/32, P95 1.230 s
- same-table QR 24 concurrent: 24/24, P95 661 ms
- no observed tenant/branch/table crossover or duplicate request groups
- one Kitchen queue per order across NEW/ADD rounds

### Chaos / recovery

`docs/chaos-recovery-test-20260819.md`

PASS:

- POS committed-response replay -> one order
- QR committed-response replay -> one QR row / one order
- payment request-group replay -> one payment row; paid_total == payment sum == order total
- stale Print Agent attempt rejected after lease expiry
- expired print lease -> new agent reclaim -> print succeeds
- retryable printer transport failure -> later agent reclaim -> print succeeds
- runtime lease revoked for Tenant A while Tenant B remains active -> Tenant A fails `SHIFT_NOT_OPEN`, creates no data, and succeeds after its own lease is restored
- final cross-scope QR = 0, waiting DB locks = 0, idle-in-transaction = 0

Blocked by test tooling, not marked pass:

- explicit artificial same-table row-lock hold + concurrent QR burst. Existing normal same-table concurrency baseline remains 24/24 from the prior load test.

## New defect found and fixed

Trial-only schema drift in expired Print Agent lease recovery:

- Primary has enum `public.print_job_status`.
- Trial has `print_jobs.status` as text + CHECK.
- Trial `app.claim_print_jobs_v2` retained two Primary enum casts and crashed only when recovering expired leases.

Permanent Trial migration:

- `20260818171221_trial_fix_expired_print_lease_status_cast.sql`

Primary was audited and is not affected.

Post-fix synthetic print verification:

- 3/3 jobs printed
- expired attempts marked expired
- transport-failed attempt marked failed/retrying
- later attempts printed
- live print claims 0
- duplicate agent_attempt_id 0

## Automated recovery regression guard

Added CI-covered Vitest regression:

- `apps/backoffice-web/tests/integration/recovery-idempotency-regression.integration.test.ts`
- commit `18328b2618d59cedee1ccb5abf8e75b82f2def15`

It locks these invariants in source/migration coverage:

- POS request-id replay and safe timeout retry
- payment request-group replay and safe timeout retry
- Table QR request-id routing and Kitchen print repair path
- one Kitchen queue number across NEW/ADD on Primary and Trial
- Trial expired-print-lease text-status compatibility guard

Targeted command added in commit `d40ffa4a1f77502864abb1c3c32f37463e35955a`:

- `pnpm qa:recovery-regression`
- backoffice direct command: `pnpm --filter backoffice-web test:recovery`

The standard CI already executes `pnpm test`, so this regression is also part of the full push/PR test suite. The targeted command exists for fast pre-release/hotfix verification and does not require Trial service-role credentials.

## Rollback-only live Trial recovery preflight

Added in commit `ef0082ad7e22a65b0b32bb5ada6ef4b80acce405`:

- SQL: `scripts/sql/trial-recovery-preflight.sql`
- manual workflow: `.github/workflows/trial-recovery-preflight.yml`

The SQL preflight was executed directly against CpiPOS-002 before being committed and passed. It verifies in one transaction:

- POS request-id replay -> exactly one order
- payment request-group replay -> one payment row and paid_total/payment sum/order total consistency
- QR request-id replay -> one submission/order
- expired Print Agent lease -> attempt 1 expired -> agent 2 reclaim -> ACK -> printed
- Tenant A runtime lease revoked while Tenant B remains active -> A fails closed without data writes -> restore A -> same request succeeds
- QR tenant/branch/table/table-session scope remains consistent

The file always ends with `ROLLBACK`. Post-run readback on CpiPOS-002 confirmed:

- preflight tenant rows 0
- order rows 0
- QR rows 0
- print rows 0
- waiting locks 0
- idle-in-transaction 0

Workflow safety:

- `workflow_dispatch` only; not part of normal push CI
- expects protected secret `CPIPOS_TRIAL_DATABASE_URL` in GitHub environment `trial`
- rejects a URL containing Primary ref `deejlitaivfnsbwqdugy`
- rejects a URL that does not identify Trial ref `kawenyvpentwgugtzqec`
- no service-role key is placed in normal CI or source

## Adaptive polling / request consolidation — phase 1

Production Vercel request baseline captured before the change:

- `/api/pos/table-qr-activity`: 466 requests/hour (~7.8/min) across production traffic
- one live POS polling stream showed a stable request every ~15 seconds while idle
- `/api/print-agent/claim`: ~2,153 requests/hour; intentionally excluded from this optimization because the verified 1/2/3s Print Agent claim/recovery loop must remain unchanged
- customer `/api/table-order/...` traffic was too low in the sampled hour to claim a meaningful P95/P99 baseline

Root cause found in:

- `apps/backoffice-web/src/components/pos-preview/pos-table-qr-global-alert.tsx`

The alert poll was already single-flight, paused while the page is hidden, and reset immediately on focus/visibility/activity, but its idle backoff stopped at 15 seconds.

Phase-1 change commit:

- `12381fa8623f376366e5e94d1692ea310d216669`
- message: `perf(pos): back off idle table QR alert polling`

New idle schedule:

- 3s -> 5s -> 10s -> 15s -> 30s while no new event arrives
- any new event resets to the fast end
- focus / visibility return schedules an immediate poll
- in-flight dedupe and hidden-tab pause remain unchanged

Safety boundary:

- this poll is only the global POS notification channel
- QR submit -> order transaction -> Kitchen dispatch is independent and was not changed
- payment, Kitchen transaction, Print Agent, MDM, and recovery semantics were not changed
- expected steady-state request rate per continuously visible idle POS falls from ~240/hour at 15s to ~120/hour at 30s after warm-up

Deployment/readback of `12381fa...` is the next verification action after this checkpoint.

## Cleanup / safety state

All previous `CHAOS-20260819` synthetic tenants and cascaded data were removed.

Live FG0003 production sessions/printer routing were not modified by concurrency, chaos, regression, Trial preflight, or polling phase-1 work.

## Next engineering step

1. verify Vercel/CI for `12381fa8623f376366e5e94d1692ea310d216669`
2. observe live `/api/pos/table-qr-activity` cadence after the new deployment reaches the active POS
3. inspect `/api/pos/session/current` for redundant polling before changing its cadence
4. phase 2: harden customer `table-order-mobile.tsx` with single-flight + hidden-tab pause/adaptive refresh while keeping visible freshness at or below 15 seconds and immediate post-submit refresh
5. measure request-count reduction before making any further polling changes

Before changing code in a new chat, inspect current GitHub/Vercel/Supabase state rather than trusting this snapshot blindly.
