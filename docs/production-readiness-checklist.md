# Production Readiness Checklist

## Functional
- [Done] Secure login context flow works (`/login/store -> /login/branches|employee -> /login/devices`).
- [Done] POS session creation and replay protection implemented.
- [Done] Shift gate before sales enforced.
- [Done] POS Sales MVP (create + pay order) available.
- [Done] Attendance APIs and role visibility implemented.
- [Done] Unified login flow is served from `backoffice-web` (single deployment surface).

## Security
- [Done] Server-side tenant/branch/device validation in auth flow.
- [Done] Feature gates enforced server-side (not UI-only).
- [Done] Quota enforcement blocks over-limit provisioning.
- [Done] Audit logging for sensitive actions.
- [Done] Public/security-sensitive login APIs have rate limiting.
- [Done] Staff-card secrets are hashed at rest and lifecycle-validated (`active|inactive|lost|revoked`).
- [Done] Public API responses use safe error messages (no DB detail leakage).
- [Must do before go-live] Rotate all production secrets.
- [Must do before go-live] Configure shared rate-limit backend env (`RATE_LIMIT_BACKEND=upstash|redis`) in production and verify fail-closed behavior.

## Database
- [Done] Migrations committed in `supabase/migrations`.
- [Done] RLS policies present for core tables.
- [Done] Static schema drift preflight available (`corepack pnpm schema:drift`).
- [Not done] Formal staged migration rehearsal record for each release.
- [Must do before go-live] Production backup snapshot before migration.
- [Must do before go-live] Confirm/apply `20260728173858_print_agent_v1.sql` and `20260728180311_cash_drawer_v1.sql` in production after `supabase migration list --linked` review; do not use `--include-all` while older drift remains.


## Web + Android 0.2.2 Runtime Status
- [Done] Web UI/runtime parity implemented on integration branch and local typecheck/tests passed before checkpoint handoff.
- [Not done] Production rollout for Web UI/runtime parity is pending.
- [Done] Android Tablet 0.2.2 local build/lint passed before checkpoint handoff.
- [Not done] Android 0.2.2 GitHub release/APK publication is pending.
- [Not done] Production Web QA is pending.
- [Not done] Physical Android Tablet QA is pending.

## Deployment
- [Done] GitHub CI workflow added (`.github/workflows/ci.yml`).
- [Done] CI covers current development/default branch `agent-docs-preflight-schema-drift` and runs frozen install, typecheck, lint, tests, schema drift, and production build with timeouts.
- [Done] Branch strategy + protection runbook documented.
- [Done] Vercel deployment mapping and environment separation documented.
- [Must do before go-live] Configure GitHub branch protection rules in repository settings.
- [Must do before go-live] Verify all Vercel project/domain mappings in production account.

## Monitoring
- [Done] Monitoring/alerting runbook documented.
- [Not done] Alert rules configured in monitoring tools with on-call routing.
- [Must do before go-live] Confirm alert ownership + escalation contact list.
- [Must do before go-live] Add alert on rate-limiter backend failures and auth fail-closed spikes.

## Definition of Done + QA
- [Done] Definition of Done documented (`docs/definition-of-done.md`).
- [Done] Manual QA checklist documented (`docs/manual-qa-checklist.md`).
- [Done] Go-live evidence template documented (`docs/go-live-evidence-checklist.md`).
- [Must do before go-live] Execute checklist and attach evidence/results to release ticket.

## Backup
- [Not done] Automated backup verification drill documented with evidence.
- [Must do before go-live] Define and test restore procedure.

## Rollback
- [Done] Incident/rollback runbook documented.
- [Not done] Dry-run rollback exercise in staging with timestamped results.
- [Must do before go-live] Verify rollback path for latest migration set.

## Operations
- [Done] Supabase migration runbook documented.
- [Done] RLS verification checklist documented.
- [Not done] Formal operational handoff session completed.
- [Must do before go-live] Complete go-live signoff across engineering + ops.
