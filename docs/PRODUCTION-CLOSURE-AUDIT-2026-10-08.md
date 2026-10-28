# CpIPOS final release closure and safety audit — 2026-10-08

**Scope:** Current `sstdevelopaminno/CpIPOS` `main` SHA `93c8ad933f59c94b080dce2b2d2c36fceb80c761`; Supabase Primary CpiPOS-001; Vercel project `cp-ipos-web`. Assessment is a read-only snapshot. No sales, payments, account states, devices, secrets, schema or Production deployments were modified by this audit.

## Executive verdict
- **Code coverage:** 93 Web page entries, 231 route handlers, 150 unit/integration test files identified on `main`. A green CI build is not proof of end-to-end device or business acceptance.
- **12-domain design:** Package, Trial, data-plane routing, Android Tablet/Windows, Mobile, UI parity, Kitchen, Printing, POS/Table, QR stock, MDM updates, and MDM bootstrapping have foundations. **No evidence to declare 12/12 production-accepted.**
- **Live DB:** 159 `public` tables with RLS enabled; 288 versions in `supabase_migrations.schema_migrations` as returned by the Supabase connector. Source contains 206 Primary SQL migration files, including legacy **12-digit** and modern **14-digit** version prefixes.
- **Migration version comparison (exact prefix through the underscore, not fixed substring):** 127 shared versions, 161 live-only versions, 79 repository-only versions. This is a **version/history mismatch**, not proof that any migration should be executed. Existing production schema may already contain equivalent SQL under different version IDs.
- **Subscription:** current catalog has 5 packages, 4 active (Starter 350, Growth 550, Business 1500, Custom). 35 catalog features, 59 package-feature rows, 13 contracts. All 5 packages currently have `mobile_app_enabled=false`; confirm commercial intent before enabling app access. The historic Master Scope package counts are stale.
- **Tenant lifecycle:** 7 records, all `data_home=primary` (3 active, 2 suspended, 1 expired, 1 trial); no live migration to Trial evidenced.
- **Supabase advisors:** 23 callable `authenticated` `SECURITY DEFINER` function warnings, 1 mutable search-path warning, 96 RLS-with-no-policy informational warnings; performance alerts include 206 unindexed FKs, 21 overlapping permissive policy findings, 1 RLS initplan. A server-only RLS/no-policy table is not automatically a vulnerability. Do not grant broad access or drop indexes without use-path analysis.
- **Vercel:** Production deployment `dpl_AYS6YTqUftxgfEN8tzeNniVGhpsg`, source `main` SHA `93c8ad9...`, READY. Environment name listing includes Primary Supabase secrets but no `RATE_LIMIT_BACKEND`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` or `TRIAL_SUPABASE_URL` / `TRIAL_SUPABASE_SERVICE_ROLE_KEY` / `TRIAL_DATA_ROUTING_ENABLED`. Missing variables may be intentional for a disabled Trial; **do not switch data_home to trial**.
- **Rate limiter:** `apps/backoffice-web/src/lib/server/rate-limit.ts` defaults to per-process memory when no backend selected. This is not distributed cross-instance protection. Do not hard-fail production login without first configuring and testing a central backend.
- **Physical gates:** #74 printer E2E and #153 multi-store POS acceptance remain open. Offline sales library exists but no fully verified offline cash-sale-to-sync path or Android offline-first release is accepted.

## Safe release gate order
1. Decide Mobile entitlements and rate-limit provider; configure secrets directly in Vercel without copying values to GitHub/chat. Run `node scripts/check-production-readiness.mjs --trial-required` **inside a trusted env** (prints only env names / block reasons), then verify cross-instance rate-limit behavior. This preflight checks presence, not whether a credential is valid.
2. Reconcile migration version lists using `node scripts/audit-live-migration-history.mjs --history /private/path/export.json` and a separate `--plane trial` export. **The tool exits 2 on mismatch and does not run SQL.** Keep reconciliation/export outside Git; audit the SQL bodies and live objects rather than matching names alone.
3. Review owner/tenant/branch controls of each callable SECURITY DEFINER function; keep intentional RLS-deny tables service-only.
4. Finish staging E2E order+payment+stock consistency, table/Kitchen/QR, physical printer, native platform and MDM tests; attach per-case test artifacts using `docs/manual-qa-checklist.md`.
5. Run controlled backup/restore, Trial conversion canary only when explicitly enabled, load/soak, monitoring, and signed release delivery.
6. Have QA, Engineering and Operations sign `docs/go-live-evidence-checklist.md`; close #74 and #153 only once physical acceptance evidence is attached.
7. Merge/release reviewed PRs after the release gate; validate the resulting commit and Production alias.

## Related work
- PR #242 request reduction and tenant routing caching; PR #243 CI/MDM; PR #244 guarded Production promotion on main; PR #245 guarded dispatch on repository default branch. These were open at audit time, not deployed.
- `scripts/schema-drift-check.mjs` verifies source markers, **not** live migration history. The offline report tool introduced in this audit is deliberately separate from runtime migrations.
- **Do not** run missing migration SQL blindly, change RLS to satisfy the advisor, force Trial cutover, or assert Printer/MDM hardware acceptance merely because a job/test passes.

## Review signoff / evidence
- Backend/source review: **completed** for inventory and known gaps.
- Production customer transaction acceptance: **not performed** in this read-only audit.
- Physical print acceptance: **pending**, #74.
- Multi-store tenant isolation and release signoff: **pending**, #153.
- Database migration history: **BLOCKED** until verified/reconciled.
- Central rate-limiter: **BLOCKED** until configured and load-tested.
- Final Production release decision: **BLOCKED**. This is a release-control finding, not a claim that existing Production is down.
