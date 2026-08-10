# CpIPOS / SST iPOS Project Context (Historical Handoff)

Last reviewed for CpIPOS: 2026-07-27
Current workspace: `E:\CpIPOS`
Current repo: `https://github.com/sstdevelopaminno/CpIPOS.git`
Current guardrail: read `docs/AI-GUARDRAILS-CPIPOS.md` first.

Historical note: older content in this file refers to `E:\SSTiPOS` and `sstdevelopaminno/SSTiPOS.git`. Do not use those values for new CpIPOS work.

This file preserves product and architecture context only. For current workspace, deployment, and environment facts, use the CpIPOS guardrails and production checkpoint.

Local dev note: if `localhost:3000` login is slow or appears stuck, read `docs/LOCAL-DEV-LOGIN-PERFORMANCE-2026-07-27.md` before debugging. Do not spend tokens chasing port 3000 if `/login/store` loads; check `.env.local`, Supabase connectivity, dev warm-up logs, and first-route compile behavior.

Task #44 table-order concurrency checkpoint: source branch `agent/table-order-concurrency-dinein-sync` separates Table QR menu/status/write rate-limit lanes, changes mobile QR polling to `?view=status`, routes POS dine-in queued edits through `replace_queued_dine_in_order_tx`, and adds empty-bill cancellation through `cancel_empty_table_bill_session_tx`. Primary/Trial migrations are source-only and must not be considered applied without a later explicit DB task.

Kitchen ticket-board UI checkpoint (2026-08-10): branch `feat/kitchen-ticket-ui` / PR #47 replaces the four-column KDS presentation with horizontally scrollable bill cards and vertically scrollable per-bill food items. Active Kitchen tickets are grouped by table when `table_id` exists; later active tickets for the same table appear as `เพิ่มรายการอาหาร`. Ticket presentation is red before any item is cleared, orange after partial clearing, and disappears after all items are cleared. The per-item `รับออเดอร์` -> `พร้อมเสิร์ฟ` -> clear interaction in this checkpoint is intentionally client-side UI state only. It does not add/change Kitchen write APIs, database schema/migrations, POS dine-in wiring, or Table QR wiring; those integrations require a later explicitly approved phase.

## 1) Product and System Scope

SST iPOS is a multi-owner, multi-branch POS platform with 4 logical surfaces:
1. `id.<domain>`: identity/login gateway (`backoffice-web` `/login/*`)
2. `pos.<domain>`: POS operations and sales flow (`backoffice-web` POS APIs/UI)
3. `admin.<domain>`: backoffice + IT admin operations (`backoffice-web`)
4. `www.<domain>`: marketing/onboarding (if enabled)

Primary architectural goals:
- strict tenant isolation
- strict branch scoping
- secure login handoff
- auditable operational actions
- feature gate + quota control for SaaS packaging

**IMPORTANT:** QR Scan login flow has been **removed** as of 2026-05-29. The system now uses only the standard Store Login / Pre-entry flow.

## 2) Completed Delivery by Prompt (1 -> 8)

### Prompt 1: Real Authentication + POS Session
- Implemented secure verification endpoints:
  - `POST /api/auth/pin/verify`
  - `POST /api/auth/staff-card/verify`
- Server-side re-validation on every verify:
  - context (`ctx`), tenant, branch, policy, device, user role
- Added/normalized auth/session persistence:
  - `pos_sessions`
  - `login_attempts`
  - `audit_logs` extension usage
  - hardened auth tables:
    - `pos_staff_cards` with hashed `card_hash` and lifecycle (`active|inactive|lost|revoked`)
- Added replay protection:
  - consume `pos_login_contexts` on success
  - reject reused context (`context_consumed`, `context_replay_detected`)
- Session handoff uses short-lived signed HttpOnly cookie (no sensitive query params)

### Prompt 2: Shift Check-in Gate
- Added shift gate flow before POS sales access:
  - `GET /api/pos/session/current`
  - `GET /api/pos/shifts/current`
  - `POST /api/pos/shifts/open`
  - `POST /api/pos/shifts/join`
  - `POST /api/pos/shifts/close`
- Bound `pos_sessions.shift_id` to active shift
- Added/used server guards:
  - `requirePosSession`
  - `requireActiveShift`
  - `requirePermission`
  - `getTenantBranchScopeFromSession`

### Prompt 3: POS Sales MVP
- Implemented minimum sellable flow for 1 real bill:
  - product loading
  - cart
  - order create
  - payment record
  - receipt preview
  - current shift order history
- APIs:
  - `GET /api/pos/products`
  - `POST /api/pos/orders`
  - `POST /api/pos/orders/:id/pay`
  - `GET /api/pos/orders/current-shift`
- Server calculates totals (client totals are not trusted)
- Scoping enforced: tenant + branch + shift + session + user + device

### Prompt 4: Attendance Real-time (Owner/Manager in POS)
- Added attendance domain:
  - `staff_attendance_records`
  - `staff_leave_requests`
  - `staff_attendance_events`
- APIs:
  - `GET /api/pos/attendance/status`
  - `POST /api/pos/attendance/check-in`
  - `POST /api/pos/attendance/check-out`
  - `POST /api/pos/attendance/manual-status`
- Role visibility:
  - owner/manager: branch summary + list
  - staff: self-only
- Real-time behavior:
  - scoped polling fallback (tenant + branch + day)
  - no broad subscription

### Prompt 5: Backoffice/Admin
- Added admin route groups and IT-admin APIs for:
  - tenants, branches, users/roles
  - devices
  - login policies
  - active sessions
  - shifts
  - features
  - audit logs
- Platform-only controls require IT admin privilege
- Mutations log to audit

### Prompt 6: Subscription / Package / Feature Gate
- Implemented package/feature/quota model using canonical existing schema:
  - `subscription_packages`
  - `subscription_package_features`
  - `tenant_subscription_contracts`
  - `tenant_feature_subscriptions`
- Added compatibility views:
  - `plans`, `plan_features`, `tenant_contracts`, `feature_subscriptions`, `branch_feature_overrides`
- Enforced feature gate server-side in auth/attendance/admin/sales flows
- Enforced quotas:
  - branches
  - devices
  - users
- Thai-market package matrix update:
  - `solo`: THB 350 monthly / THB 3,850 yearly, 1 branch, 1 device, 3 users
  - `starter`: THB 690 monthly / THB 7,590 yearly, 1 branch, 2 devices, 5 users
  - `growth`: THB 1,290 monthly / THB 14,190 yearly, 2 branches, 2 devices per branch, 10 users
  - `enterprise`: THB 2,490 monthly / THB 27,390 yearly, 5 branches, 4 devices per branch, 30 users
- POS menu and API package locks are centralized through `apps/backoffice-web/src/lib/pos-feature-map.ts` plus server-side feature checks. Locked APIs return `feature_not_enabled`.
- Stock remains mapped to `core_pos_sales` until `stock_management` is production-ready as a separate entitlement.

### Prompt 7: Production Deployment Readiness
- Added CI and operations documentation:
  - branch strategy
  - env checklist
  - migration runbook
  - RLS verification checklist
  - monitoring/alerting runbook
  - incident/rollback runbook
  - production readiness checklist

### Prompt 8: Final Hardening + Definition of Done
- Added final readiness docs:
  - `docs/definition-of-done.md`
  - `docs/manual-qa-checklist.md`
- Added rate limiting to public/security-sensitive endpoints:
  - `/api/store/resolve`
  - `/api/store/login-context`
  - `/api/auth/pin/verify`
  - `/api/auth/staff-card/verify`
- Added centralized-capable rate limiter abstraction:
  - `RATE_LIMIT_BACKEND=memory|upstash|redis`
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`
  - auth verify routes fail closed in production when backend is unavailable
- Added safer public error responses (avoid DB/internal detail leakage)
- Expanded audit coverage in login/replay/failure paths
- Added audit schema compatibility migration for legacy/local DBs missing `audit_logs.target_user_id` and related columns.
- Updated `/api/pos/perf` to fail-soft (`logged:false` non-blocking response) so perf/audit write failures do not block POS preview/session UI.
- Added timeout+retry resilience in POS preview session gate (`/preview/pos`) to avoid indefinite loading state.
- Updated architecture/handoff/readiness/README docs
- Checks passed at prompt completion:
  - `typecheck`: pass
  - `lint`: pass
  - `build`: pass

## 3) Security Invariants (Must Never Break)

1. Never trust client-sent `tenant_id`, `branch_id`, `store_code`, `device_code`.
2. Login flow must use opaque `ctx` and server-side re-validation.
3. `ctx` must be short-lived and consumed once authentication succeeds.
4. Consumed/expired context must be rejected (replay blocked).
5. Service role keys are server-only; never expose to client bundles.
6. Sensitive queries must stay tenant-scoped and branch-scoped.
7. Feature gates must be enforced server-side, not UI-only.
8. Shift gate must block sales APIs without active shift.
9. Audit logs must exist for sensitive auth/admin/sales/attendance actions.
10. Public/auth endpoints must be rate-limited.

## 4) Critical Error Codes to Preserve

Login/context/device:
- `missing_context`
- `invalid_context`
- `expired_context`
- `context_consumed`
- `context_replay_detected`
- `missing_device`
- `unregistered_device`
- `inactive_device`
- `device_branch_mismatch`
- `device_tenant_mismatch`
- `device_not_allowed`
- `device_policy_blocked`
- `login_method_not_allowed`
- `role_not_allowed`
- `auth_failed`
- `session_creation_failed`
- `rate_limited`

## 5) Current Endpoint Security Pattern

For every sensitive route:
1. derive scope from trusted server session/context
2. validate tenant+branch+policy+device+role
3. enforce feature gate and quota where applicable
4. enforce rate limit on public/login routes
5. write login_attempts and/or audit logs
6. return safe public errors

## 6) Key Documents (Read First)

- `docs/ACTIVE-DOCS-INDEX.md`
- `docs/POS-LOGIN-ARCHITECTURE-PHASE-NEXT.md`
- `docs/definition-of-done.md`
- `docs/manual-qa-checklist.md`
- `docs/production-readiness-checklist.md`
- `docs/production-env-checklist.md`
- `docs/supabase-migration-runbook.md`
- `docs/rls-verification-checklist.md`
- `docs/monitoring-alerting-runbook.md`
- `docs/incident-runbook.md`
- `docs/go-live-evidence-checklist.md`

## 7) Environment and Secrets

Important env vars include:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `POS_LOGIN_CONTEXT_TTL_MINUTES`
- `POS_SESSION_HANDOFF_SECRET`
- `POS_SESSION_COOKIE_*`
- rate-limit knobs:
  - `POS_PUBLIC_RATE_LIMIT_WINDOW_SECONDS`
  - `POS_STORE_RESOLVE_RATE_LIMIT_MAX`
  - `POS_STORE_LOGIN_CONTEXT_RATE_LIMIT_MAX`
  - `POS_LOGIN_RATE_LIMIT_IP_MAX`
  - `POS_LOGIN_RATE_LIMIT_DEVICE_MAX`
  - `RATE_LIMIT_BACKEND`
  - `RATE_LIMIT_REDIS_PREFIX`
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`

QR/mobile login environment variables were removed with the QR Scan login flow on 2026-05-29. Do not add new `MOBILE_*` or `POS_QR_*` env requirements unless a new mobile login architecture is explicitly approved and documented.

## 8) Known Gaps / Go-live Blockers

Must complete before production go-live:
1. run manual QA checklist with evidence/signoff
2. rotate all production secrets and verify no leakage
3. run restore + rollback drills and keep reports
4. verify monitoring alerts and on-call ownership
5. configure centralized rate limiter in production env and verify fail-closed behavior
6. complete and attach `docs/go-live-evidence-checklist.md` evidence to release ticket

## 9) Guidance for Future GPT/Codex

When implementing next features:
1. keep security invariants in section 3 unchanged
2. avoid schema/logic changes that bypass tenant/branch scope
3. do not add client-trusted identifiers for auth/sales scope
4. extend existing guard utilities, do not duplicate ad hoc checks
5. keep audit logging and failure logging on all sensitive mutations
6. update docs with every behavior change
7. run `typecheck`, `lint`, and `build` before closing

If unsure, prefer safer behavior and explicit rejection over permissive behavior.

## 10) Local Troubleshooting (POS Preview Loading)

If `/preview/pos` hangs on `Loading POS session...`:
1. apply latest Supabase migrations (especially audit compatibility migration)
2. restart local dev server
3. verify `GET /api/pos/session/current` returns either:
   - `401` with `missing_pos_session`, or
   - `200` with session payload
4. verify `GET /api/pos/shifts/current` returns safe non-500 response in normal missing-shift flow
5. verify `POST /api/pos/perf` failures do not block UI (should return non-blocking `logged:false`)
