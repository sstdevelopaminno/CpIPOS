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

## Cleanup / safety state

All `CHAOS-20260819` synthetic tenants and cascaded data were removed.

Final Trial readback:

- synthetic tenants 0
- branches 0
- orders 0
- QR rows 0
- print jobs 0
- temporary `http` extension absent
- temporary `dblink` extension absent
- synthetic lock helper absent
- waiting locks 0
- idle-in-transaction 0
- chaos Edge runner is JWT-protected and returns HTTP 410; test token removed

Live FG0003 production sessions/printer routing were not modified by the chaos test.

## Next engineering step

1. verify final CI/Vercel status for the automated recovery regression commits
2. add an explicit non-destructive Trial recovery preflight job that is manually invoked and requires protected Trial credentials rather than putting service-role secrets into normal CI
3. include runtime lease fail-closed and expired Print Agent lease reclaim in that Trial preflight
4. retain the explicit delayed same-table contention test as an isolated future Trial job when safe concurrent test tooling is available
5. continue UI/request-churn performance hardening only after regression/preflight gates remain green

Before changing code in a new chat, inspect current GitHub/Vercel/Supabase state rather than trusting this snapshot blindly.