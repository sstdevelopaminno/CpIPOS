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
