# CpIPOS / SST iPOS Project Context (Historical Handoff)

Last reviewed for CpIPOS: 2026-07-27
Current workspace: `E:\CpIPOS`
Current repo: `https://github.com/sstdevelopaminno/CpIPOS.git`
Current guardrail: read `docs/AI-GUARDRAILS-CPIPOS.md` first.

Historical note: older content in this file refers to `E:\SSTiPOS` and `sstdevelopaminno/SSTiPOS.git`. Do not use those values for new CpIPOS work.

This file preserves product and architecture context only. For current workspace, deployment, and environment facts, use the CpIPOS guardrails and production checkpoint.

Local dev note: if `localhost:3000` login is slow or appears stuck, read `docs/LOCAL-DEV-LOGIN-PERFORMANCE-2026-07-27.md` before debugging. Do not spend tokens chasing port 3000 if `/login/store` loads; check `.env.local`, Supabase connectivity, dev warm-up logs, and first-route compile behavior.

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

## 11) Removed: QR Scan Login Flow (2026-05-29)

The QR Scan login flow has been completely removed from the system.

What was removed:
- UI pages: `/scan`, `/qr-scan`, `/login/qr-scan`, `/login/qr-card`, `/login/qr-success`
- API routes: `/api/auth/qr/*`, `/api/mobile/login/*`, `/api/mobile/activation/*`, `/api/auth/employee/verify-qr`
- Test scripts: `qr-register-e2e-smoke.mjs`, `qr-branch-approve-smoke.mjs`
- Environment variables: `POS_QR_APPROVAL_SECRET`, `NEXT_PUBLIC_POS_QR_APPROVAL_KEY`, `POS_QR_CREATE_RATE_LIMIT_MAX`, all `MOBILE_*` variables

Database tables remain for backward compatibility but are no longer used:
- `pos_qr_login_tokens` (deprecated, no new tokens created)
- Related QR/mobile policy fields in `branch_policies` (will not be read by login flow)

Current login flow uses only Store Login / Pre-entry:
1. `/login/store` - store code verification
2. `/login/branches` - branch selection (if multi-branch)
3. `/login/employee` - employee code verification only (no QR)
4. `/login/devices` - device/register selection
5. POS session established and user redirected to `/preview/pos`

All security invariants regarding tenant/branch/device/role scoping remain **strictly enforced**.

## Table QR Customer Order Submit Fix (2026-06-10)

### What changed
- Fixed customer QR table ordering submit failure.
- Public customer QR submit now reaches the backend transaction and can insert customer items into the active dine-in table order.
- Fixed Supabase RPC error: `column reference "table_id" is ambiguous`.
- The RPC now qualifies `table_bill_sessions.table_id = v_qr.table_id`.
- Customer submit payload was normalized to send only server-safe fields: `request_id`, `items.product_id`, and numeric `quantity`.
- Client totals/prices remain display-only. Server/database totals remain authoritative.
- The POS shift close reminder was restored to its original behavior: `ต่อกะ` closes the old shift and opens the next shift, and still shows the override error when the shift cannot be closed.

### Files changed
- apps/backoffice-web/src/app/api/table-order/[token]/route.ts
- apps/backoffice-web/src/components/table-order/table-order-mobile.tsx
- apps/backoffice-web/src/components/pos/table-qr-order-modal.tsx
- apps/backoffice-web/src/components/pos/pos-shift-cycle-guard.tsx
- supabase/migrations/202606100001_fix_table_qr_order_tx_table_id_ambiguity.sql

### Verification
- Customer QR submit succeeded and returned a DIN-QR bill number.
- Submitted QR customer items appeared back in the correct POS table cart/order.
- pnpm build passed locally.


## POS Stock Deduction Investigation Handoff (2026-06-11)

### Current status

POS pre-entry login and device selection now work in production for the seeded tenant/branch/device flow.

Verified working login path:

* Store/Tenant code: `NDL-TH-001`
* Branch: `NDL-ONNUT-01` / `อ่อนนุช`
* Employee code: `sst182536`
* PIN: `182536`
* Role: `owner`
* POS device: `NDL-ONNUT-POS-01`
* Production URL: `/preview/pos`

### Current stock issue under investigation

The next blocker is stock deduction after POS sales.

Observed diagnostic result:

* Latest order stock deduction diagnostic returned `Success. No rows returned`.
* Latest order stock movement diagnostic returned `Success. No rows returned`.

This means the diagnostic query did not find a latest order for the checked tenant/branch scope, so the stock deduction issue is not yet proven to be a deduction failure. First confirm whether POS order creation is actually writing rows into `orders` and `order_items`.

### Important stock model

The current system is designed around recipe/ingredient stock tracking:

* `products` = sellable menu items.
* `ingredients` = actual stock quantities.
* `recipes` = mapping from product to ingredient usage per sold item.
* `stock_movements` = audit/history of stock in/out.
* Recipe-based deduction updates `ingredients.quantity_on_hand` and writes `stock_movements`.

For product stock that should behave like simple unit stock, use the existing bridge model:

* Create a fallback ingredient named like `STOCK:<sku>:<product_name>`.
* Create a recipe line of `1` unit per product.
* Set the product to recipe-based stock deduction mode when supported.

Do not rely on client-side totals or client-submitted tenant/branch ids. Tenant, branch, user, role, device, POS session, shift, and feature gates must remain server-resolved.

Package and feature changes must stay compatible with the separate SSTiPOSSupport IT Admin surface because both systems share the Supabase tenant/package contract data.

### Next verification queries

1. Check whether any orders exist in production:

```sql
SELECT
  t.code AS tenant_code,
  b.code AS branch_code,
  b.name AS branch_name,
  o.id AS order_id,
  o.order_no,
  o.status,
  o.order_type,
  o.total_amount,
  o.created_at,
  COUNT(oi.id) AS item_count
FROM public.orders o
JOIN public.tenants t ON t.id = o.tenant_id
JOIN public.branches b ON b.id = o.branch_id
LEFT JOIN public.order_items oi ON oi.order_id = o.id
GROUP BY
  t.code,
  b.code,
  b.name,
  o.id,
  o.order_no,
  o.status,
  o.order_type,
  o.total_amount,
  o.created_at
ORDER BY o.created_at DESC
LIMIT 20;
```

2. If orders exist, inspect product recipe linkage for the latest order:

```sql
WITH latest_order AS (
  SELECT o.*
  FROM public.orders o
  ORDER BY o.created_at DESC
  LIMIT 1
)
SELECT
  t.code AS tenant_code,
  b.code AS branch_code,
  o.order_no,
  o.status,
  p.name AS product_name,
  p.stock_deduction_mode,
  oi.quantity,
  COUNT(r.ingredient_id) AS recipe_lines
FROM latest_order o
JOIN public.tenants t ON t.id = o.tenant_id
JOIN public.branches b ON b.id = o.branch_id
JOIN public.order_items oi ON oi.order_id = o.id
JOIN public.products p
  ON p.id = oi.product_id
 AND p.tenant_id = o.tenant_id
 AND p.branch_id = o.branch_id
LEFT JOIN public.recipes r
  ON r.product_id = p.id
 AND r.tenant_id = p.tenant_id
 AND r.branch_id = p.branch_id
GROUP BY
  t.code,
  b.code,
  o.order_no,
  o.status,
  p.name,
  p.stock_deduction_mode,
  oi.quantity
ORDER BY p.name;
```

### Interpretation

* If no orders exist, debug the POS checkout/order creation flow first.
* If orders exist but no `order_items`, debug order item insert.
* If orders and items exist but `recipe_lines = 0`, repair product recipe/stock bridge setup.
* If `recipe_lines > 0` but no `stock_movements`, debug the stock deduction execution path in `pos-sales-service`.
* If `stock_movements` exists but UI stock does not change, debug stock UI refresh/cache.

## INET NOPS QR Payment Additive Provider (2026-06-23)

- Branch: `feature/inet-nops-callback`.
- Scope: add INET NOPS QR payment as an optional provider without removing PromptPay/manual bank transfer.
- Existing PromptPay QR link, QR image, and manual bank-transfer confirmation remain the default payment flow.
- New provider setting table: `pos_payment_provider_settings`.
- New stored intent/callback tables: `pos_payment_intents`, `pos_payment_callback_logs`.
- Merchant keys are server-only env vars; no `NEXT_PUBLIC_` INET secret is allowed.
- POS QR creation endpoint: `POST /api/pos/payments/inet/qr`, accepting only `{ order_id }` and resolving tenant/branch/order/amount from trusted POS session and DB rows.
- POS status endpoint: `GET /api/pos/payments/inet/status?payment_intent_id=...`, scoped to the current POS session.
- Public INET callback endpoint: `POST /api/payments/inet/callback`.
- Callback must resolve tenant/branch only from `pos_payment_intents.provider_order_id`; callback tenant/branch payload fields are not trusted.
- Successful callback finalizes payment as existing-compatible `bank_transfer` with reference `INET:<payment_reference_id/ref1/order_id>`.
- INET remains disabled unless `pos_payment_provider_settings.provider='inet_nops'` is active for the tenant/branch.
- UAT env keys were added to `apps/backoffice-web/.env.example`.

### INET Documentation Alignment (2026-06-23)

- Reviewed the INET `NEW_OPS_API_V.2.pdf` and `Callback Server to Server (QRCode & Other) V.2.pdf` documents.
- Confirmed the sandbox sequence: OAuth HTTP/JSON code `201`, access-token `201`, CreatePayment QR `200`; sandbox payment success is triggered with INET's `Complete Transactions` action, not a real money transfer.
- Callback contract is `event=payment_status_change` with `detail.response_code` `0` for success and `1` for failure. INET retries non-200 callback responses at most 10 times, one second apart.
- Callback logs now retain documented reconciliation fields and redact optional `payer` account/card data. Invalid merchant/amount callbacks are logged but do not fail or settle the stored payment intent.
- Added `docs/INET-NOPS-UAT-TEST.md` and callback regression coverage for automatic POS settlement and duplicate retries.

### INET QR Settings And Package Gate (2026-06-24)

- Added feature code `inet_nops_qr`, package catalog metadata, and migration `20260623174225_inet_nops_settings_feature.sql`.
- Added owner-only API `/api/pos/settings/inet-nops` and a separate `INET QR` settings menu with branch selection, UAT/Production, Merchant ID, enable switch, callback URL copy, server-key status, and UAT OAuth probe.
- Merchant Key remains deployment-secret-only; the browser never receives it.
- The package gate is enforced in both the POS sales snapshot and QR-creation route, not only the settings UI.
- Saved pending questions for INET in `docs/INET-NOPS-QUESTIONS-FOR-INET.md`.

## CI / Print Agent / Cash Drawer Hardening (2026-07-29)

- Branch: `agent-docs-preflight-schema-drift`.
- CI now includes the current branch on push and PR, keeps `main`, `develop`, and `hotfix/**`, and runs frozen install, typecheck, lint, tests, schema drift, and production build with timeouts.
- Print Agent and printer/cash drawer API fallback errors now return safe public messages with server-side reference IDs instead of raw internal messages.
- Bluetooth printer health/discover/connect routes now use server-side bridge timeouts.
- Cash drawer migration now includes cooldown indexes for scope/status and device-scoped cooldown queries.
- Verification passed locally: install, typecheck, tests, lint, schema drift, build, and unauth production smoke checks.
- Production migration compare/apply and deployment are still blocked until Supabase CLI/linked project and operator confirmation are available.

## POS Navigation Settings (2026-07-29)

- POS sidebar main menu was simplified: Sales Summary, Receipt History, Table Management, Product Management, and Members moved into the `More` / `เพิ่มเติม` page at `/preview/pos/more`, shown after Open/Close Shift.
- Staff role must not see the More menu and direct `/preview/pos/more` access redirects to `/preview/pos`.
- Keep these moved route links feature-gated with `featureForPosRoute()` in `pos-more-workspace.tsx`; do not move them back to `pos-settings-workspace.tsx` unless product direction changes.
- Each moved page must keep a deterministic Back to More button linking to `/preview/pos/more`.
- Settings now has `Change Language` and `Main Menu Position` popups.
- Main menu placement moves the whole POS navigation bar: `left` keeps the original vertical sidebar, `top` uses a horizontal top bar, and `bottom` uses a horizontal bottom bar.
- Main menu placement is client-side per terminal using localStorage key `pos_main_menu_bar_position_v2` and event `pos-main-menu-placement-updated`.
- Detailed handoff: `docs/POS-NAVIGATION-SETTINGS-2026-07-29.md`.
