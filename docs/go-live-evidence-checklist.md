# Go-live Evidence Checklist

This document captures operational evidence required before production go-live.

## A) Manual QA Signoff

Reference checklist: `docs/manual-qa-checklist.md`

Required evidence:
- Tester name:
- Date:
- Environment (`staging`/`production-preview`):
- Tenant/branch tested:
- Overall result (`pass`/`fail`):
- Evidence link (ticket/video/log/screenshot):
- Failed cases:
- Resolution summary:
- Retest result:

## A1) Engineering Baseline

Required evidence:
- Git branch/commit:
- Node/npm/pnpm versions:
- `typecheck` result:
- `test` result:
- `lint` result:
- `schema:drift` result:
- `build` result:
- Known local cache or permission issues:
- Evidence link:

Latest local evidence, 2026-07-29:
- Git branch/commit: `agent-docs-preflight-schema-drift`, commit pending.
- Node/npm/pnpm versions: Node 22 range project; pnpm `10.33.4` used by Corepack.
- `typecheck` result: passed.
- `test` result: passed, 30 files / 75 tests.
- `lint` result: passed.
- `schema:drift` result: passed, 75 migrations scanned.
- `build` result: passed, Next.js production build generated 159 static pages.
- Smoke result: production unauth HEAD `/login/store` 200, `/login/branches` 200, `/api/pos/session/current` 401 expected, POST `/api/print-agent/v1/heartbeat` without key 401 expected.
- Known blockers: Supabase CLI unavailable in this shell, production migration compare/apply not performed; GitHub CI/Vercel deploy not run in this round.
- Files changed: `.github/workflows/ci.yml`; print-agent/printer/cash-drawer API routes; `src/lib/printing/print-api-errors.ts`; print-agent and Bluetooth timeout integration tests; `scripts/schema-drift-check.mjs`; `supabase/migrations/20260728180311_cash_drawer_v1.sql`; README/context/active docs/handoff/readiness/evidence/print audit docs.
- Evidence link: local command output in this Codex session.

## B) Secret Rotation Evidence

Required evidence:
- Supabase anon key reviewed:
- Supabase service role rotated (if exposed during development):
- `SESSION_SECRET` rotated:
- `INTERNAL_API_SECRET` rotated (if used):
- Vercel env vars updated:
- Old secrets revoked:
- Secret scan confirms no real secrets committed:
- Evidence link:

## C) Restore/Rollback Drill Evidence

Required evidence:
- Supabase backup snapshot ID/time:
- Restore drill date:
- Restore drill result:
- Vercel rollback tested date:
- Migration rollback/mitigation test result:
- Incident runbook walkthrough completed:
- Evidence link:

## D) Alert and On-call Ownership

Required evidence:
- Alert destinations (PagerDuty/Slack/email):
- Primary owner:
- Secondary owner:
- Escalation path:
- Login failure spike alert configured:
- Order failure alert configured:
- Database error alert configured:
- Rate limit spike/backend failure alert configured:
- 5xx spike alert configured:
- Evidence link:

---

## Release acceptance update — 2026-10-08 (source + read-only production audit)

Evidence report: [PRODUCTION-CLOSURE-AUDIT-2026-10-08.md](PRODUCTION-CLOSURE-AUDIT-2026-10-08.md)
QA scenarios: [manual-qa-checklist.md](manual-qa-checklist.md)

- [ ] Verify the **exact Production** deployment SHA matches the approved main commit and accepted PRs; the audited Production was `93c8ad9`.
- [ ] Reconcile Primary **and** Trial migration version lists with the repo by exact numeric version prefix; investigate divergent SQL content. The source marker scan is insufficient.
- [ ] Attach read-only Supabase security/performance advisor review with decisions for callable `SECURITY DEFINER` functions, RLS/no-policy service-only access, and hot foreign-key indexes.
- [ ] **Approved memory-only operating mode:** Vercel Production `RATE_LIMIT_BACKEND=memory` is configured, with a documented per-instance counting limitation. Attach independently verified Vercel WAF rule ID, affected `POST` login routes, thresholds, samples of allowed/429 requests, legitimate shared-IP false-positive check, billing/limits review and rule rollback plan. A successful source preflight alone is **not** security acceptance. If distributed in-app limits are later mandatory, provide validated Upstash credentials and outage testing; use `--distributed-rate-limit-required` in that release.
- [ ] Confirm Mobile entitlement policy: all package records had `mobile_app_enabled=false` at audit; do not silently flip without a commercial decision.
- [ ] Verify Trial routing credentials and a reversible Trial-to-Paid canary in a dedicated test scope; do not change Production `tenant_data_lifecycle.data_home` merely to pass this checklist.
- [ ] Reconcile real shift/order/payment/stock totals under simultaneous cashier, terminal and Table QR activity.
- [ ] Attach photos and device logs for LAN/Bluetooth/USB physical receipt + Kitchen printing, retry/reprint and offline hardware failure; link Issue #74.
- [ ] Validate Android Stable/Modern and native Mobile APK, Windows installer, MDM enroll/update/rollback on representative devices/OEMs.
- [ ] Perform documented restore/rollback drill and mixed multi-tenant load/soak, with p50/p95/p99/error rate and queue age.
- [ ] Cloudflare Free standby, if adopted: independently build and health-test the second runtime, validate Free-plan resource limits and `nodejs_compat`, verify identical required server-only secrets without leakage, rehearse safe manual routing/rollback for a test hostname, and prove Supabase backup/restore separately. **DNS/CDN/proxy alone is not a failover server.** See [Cloudflare free standby runbook](CLOUDFLARE-FREE-STANDBY-RUNBOOK-2026-10-08.md).
- [ ] Attach QA/Engineering/Operations signoff and clear Issue #153 only after all gates pass.

**Audit decision: BLOCKED for new/multi-store rollout.** This is an acceptance-evidence status, not a claim of an active customer outage. The 2026-07-29 evidence above is historical and is not a release signoff for current Production.
