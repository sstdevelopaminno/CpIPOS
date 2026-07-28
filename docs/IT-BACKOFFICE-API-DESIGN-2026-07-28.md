# IT Backoffice API Design 2026-07-28

Purpose: design the next IT/admin backend API layer for CpIPOS multi-tenant operations: create/manage stores, branches, users, devices, packages, contracts, feature locks, and operational controls.

Status: Phase 1 implemented and production migration applied. Matching routes, service layer, and migration file exist in the workspace. Code is ready for commit/push/deploy after final verification.

## Current Baseline

- App: `apps/backoffice-web`
- Current admin guard: `apps/backoffice-web/src/lib/it-admin-guard.ts`
- Current platform routes: `apps/backoffice-web/src/app/api/it-admin/admin/*`
- Current package routes: `apps/backoffice-web/src/app/api/it-admin/packages/*`
- Current production URL: `https://cp-ipos-web.vercel.app`
- Latest deployed QR commits before this design:
  - `345ba2f Fix table QR closed bill popup`
  - `3eec4a3 Fix table QR category rail`
  - `592dcf9 Fix table QR config handling`

Current code already supports important foundations:

- IT-admin protected access via `requireItAdmin()`.
- Tenant list and tenant-scoped admin pages.
- Branch management.
- User/role assignment management.
- Device management and lock status.
- Login policy management.
- Session and shift controls.
- Contract/plan update.
- Tenant/branch feature override.
- Activation tokens and device enrollment.
- Audit logging through `appendAuditLog`.

## Phase 1 Implementation Added

Implemented in this round:

- `supabase/migrations/20260728160924_it_admin_v1_summary_api.sql`
  - `public.it_admin_tenant_summary_v`
  - `public.get_it_admin_tenant_summary(...)`
  - service-role-only grants
  - indexes for tenant/branch/device/session/shift summary counts
- `apps/backoffice-web/src/lib/services/it-admin/tenant-admin-service.ts`
  - paginated tenant summary with RPC path and compatibility fallback
  - tenant detail
  - tenant create
  - tenant update
  - tenant suspend/reactivate/soft-delete workflow
- `apps/backoffice-web/src/lib/services/it-admin/package-admin-service.ts`
  - package catalog list
  - package create/update
  - package soft deactivate
  - package feature matrix upsert
- `apps/backoffice-web/src/app/api/it-admin/v1/*`
  - health
  - tenants
  - tenant detail/update/soft delete
  - tenant suspend/reactivate
  - packages create/update/deactivate
  - v1 facade routes for branches, users, devices, contract, features, activation tokens, device enrollments, and audit logs
- `apps/backoffice-web/src/app/api/it-admin/admin/tenants/route.ts`
  - now uses `listTenantSummaries(...)` instead of unbounded app-memory branch/session aggregation.

Verification:

- `corepack pnpm --filter backoffice-web typecheck`: passed.
- Targeted ESLint for `src/app/api/it-admin/admin/tenants/route.ts`, `src/app/api/it-admin/v1`, and `src/lib/services/it-admin`: passed.
- `corepack pnpm --filter backoffice-web test`: passed, 28 files / 68 tests.
- `corepack pnpm --filter backoffice-web build`: first 5-minute run timed out, 10-minute rerun passed and showed the new `/api/it-admin/v1/*` routes.
- `cmd /c supabase migration list --local`: could not verify because local Supabase Postgres was not running on `127.0.0.1:54322`.
- Production Supabase migration was applied directly with `supabase db query --linked --file supabase/migrations/20260728160924_it_admin_v1_summary_api.sql`.
- Production verification passed:
  - `public.it_admin_tenant_summary_v` exists.
  - `public.get_it_admin_tenant_summary(...)` exists.
  - `select count(*) from public.get_it_admin_tenant_summary(1, null, null, null, null, null)` returned 1 sample row.
- Migration history was repaired only for `20260728160924` as applied after SQL execution.
- Existing migration drift remains outside this change: remote has six older migration versions not present locally, and local has several 20260718-20260723 migrations not marked remote. Do not run `supabase db push --include-all` until this drift is reviewed.

## Supabase Notes

The admin API should stay behind Next.js server routes and use the server-only Supabase service client where privileged writes are required.

Do not expose new operational tables directly to public/client Data API consumers. Supabase has a breaking-change path where new public-schema tables are not automatically exposed to Data/GraphQL APIs. This reinforces the decision to use explicit application API routes as the stable contract for IT Backoffice.

Reference checked: Supabase changelog, breaking changes for Data APIs and platform logs, 2026-07-28.

## API Boundary

Use these stable boundaries:

- Customer/POS clients: `/api/pos/*`, `/api/table-order/*`
- Tenant owner/manager backoffice: `/api/backoffice/*`
- Platform IT/admin UI: `/api/it-admin/admin/*`
- Future public/internal IT integration: `/api/it-admin/v1/*`

Recommendation: keep existing `/api/it-admin/admin/*` routes for the current UI, then add `/api/it-admin/v1/*` as a cleaner versioned facade for the future IT backend. The v1 facade can call shared services instead of duplicating logic.

## Authentication And Authorization

All IT API routes must require:

- Auth context resolved server-side.
- `platformRole === "it_admin"` for platform-wide changes.
- No trusted `tenant_id`, `branch_id`, `user_id`, package, price, or feature state from client without DB validation.
- Mutations must write audit logs.
- Sensitive routes should support idempotency keys.

Role levels:

- `it_admin`: full platform control.
- `support_admin`: read-only or safe operational reset, no package price/contract deletion.
- `tenant_owner`: tenant-scoped controls only, not platform package/catalog management.
- `tenant_manager`: branch-scoped operational controls only.

Do not expose `TABLE_QR_SIGNING_SECRET`, service-role keys, Vercel tokens, Supabase tokens, or payment provider secrets through customer-facing settings.

## Standard Response Shape

Use the existing `ok()` / `fail()` helper shape.

Success:

```json
{
  "data": {},
  "request_id": "optional-id",
  "server_time": "2026-07-28T15:00:00.000Z"
}
```

Failure:

```json
{
  "error": {
    "code": "quota_blocked",
    "message": "Human-readable message."
  }
}
```

Add headers for operational diagnosis:

- `x-request-id`
- `x-admin-api-ms`
- `x-cache-status` when cache is used

## Pagination And Bottleneck Rules

This is mandatory for multi-owner/multi-branch scale:

- Every list endpoint must accept `limit`, `cursor`, and scoped filters.
- Default `limit`: 25 or 50.
- Max `limit`: 100.
- Avoid unbounded `.select("*")`.
- Avoid pulling all branches/sessions for all tenants in app memory.
- Prefer aggregate SQL view/RPC for dashboard summaries.
- Add composite indexes around `tenant_id`, `branch_id`, `status`, `created_at`, `updated_at`.
- Cache feature/package read decisions for a short TTL and invalidate by tenant after mutation.

Known current bottleneck:

- `GET /api/it-admin/admin/tenants` loads tenants, then separately loads branches and active sessions for all listed tenants. This is acceptable at small scale but should be replaced with a paginated tenant summary view/RPC before many stores/branches are onboarded.

Recommended DB/API replacement:

- `app.get_it_admin_tenant_summary(limit, cursor, search, status)`
- Return tenant rows with `branch_count`, `active_session_count`, `device_count`, `open_shift_count`, `package_code`, `contract_status`.

## API Map

### Platform Health

`GET /api/it-admin/v1/health`

Returns platform readiness without secrets.

Fields:

- app version / commit sha
- Supabase reachable: boolean
- required env configured: boolean map only
- table QR signing configured: boolean
- last deployment time if available
- degraded services

### Tenants / Stores

`GET /api/it-admin/v1/tenants`

List tenants with pagination and summary counts.

Query:

- `limit`
- `cursor`
- `search`
- `status=active|inactive|suspended|all`
- `package_code`

`POST /api/it-admin/v1/tenants`

Create/open a new store tenant.

Required payload:

```json
{
  "code": "NDL-TH-001",
  "name": "ร้านก๋วยเตี๋ยว NDL",
  "owner": {
    "name": "Owner name",
    "phone": "0800000000",
    "email": "owner@example.com"
  },
  "initial_branch": {
    "code": "NDL-PHET-02",
    "name": "ถนนเพชรบุรี"
  },
  "package_id": "uuid",
  "contract": {
    "status": "trial",
    "billing_interval": "monthly",
    "max_branches": 1,
    "max_devices": 1,
    "max_users": 3
  }
}
```

Behavior:

- Validate unique tenant code.
- Create tenant.
- Create first branch.
- Create owner profile or invite record.
- Assign owner role to branch.
- Create initial contract.
- Apply package feature defaults.
- Write audit log `tenant_created`.
- Return tenant, branch, owner, contract, and next setup steps.

`GET /api/it-admin/v1/tenants/{tenantId}`

Detailed tenant profile with branches, contract summary, feature summary, quota usage, and operational warnings.

`PATCH /api/it-admin/v1/tenants/{tenantId}`

Update store profile.

Allowed:

- name
- owner contact fields
- store display profile
- active/suspended state
- metadata

`POST /api/it-admin/v1/tenants/{tenantId}/suspend`

Suspend store operations without deleting data.

`POST /api/it-admin/v1/tenants/{tenantId}/reactivate`

Reactivate a suspended store.

`DELETE /api/it-admin/v1/tenants/{tenantId}`

Do not hard delete by default. Use soft delete/deactivation:

- set tenant inactive
- revoke POS sessions
- block devices
- end contract
- keep audit and sales history

Require a stronger confirmation payload:

```json
{
  "confirm_code": "TENANT-CODE",
  "reason": "Customer cancelled contract"
}
```

### Branches

`GET /api/it-admin/v1/tenants/{tenantId}/branches`

List branches with pagination, status, device count, active sessions, open shifts.

`POST /api/it-admin/v1/tenants/{tenantId}/branches`

Create branch.

Rules:

- require `branch_management`
- enforce `max_branches`
- validate unique branch code inside tenant
- audit `admin_branch_created`

`PATCH /api/it-admin/v1/tenants/{tenantId}/branches/{branchId}`

Update branch profile/status.

`DELETE /api/it-admin/v1/tenants/{tenantId}/branches/{branchId}`

Soft delete/deactivate branch. Block if open shifts/open bills exist unless a guarded recovery action is supplied.

### Users And Roles

`GET /api/it-admin/v1/tenants/{tenantId}/users`

List users and branch roles.

`POST /api/it-admin/v1/tenants/{tenantId}/users`

Create or invite user and assign branch roles.

Rules:

- require `user_management`
- enforce `max_users`
- never trust client-sent role escalation without IT admin guard
- audit `admin_user_created` / `admin_user_role_assigned`

`PATCH /api/it-admin/v1/tenants/{tenantId}/users/{userId}`

Update display profile, active state, or role assignments.

`DELETE /api/it-admin/v1/tenants/{tenantId}/users/{userId}`

Deactivate tenant role mapping, not necessarily global auth user deletion.

### Devices

`GET /api/it-admin/v1/tenants/{tenantId}/devices`

Filter by branch, status, device type.

`PATCH /api/it-admin/v1/tenants/{tenantId}/devices/{deviceId}`

Actions:

- approve
- activate
- deactivate
- block
- lock
- unlock
- rename

Rules:

- require `device_management`
- enforce `max_devices` when approving/activating
- audit every state change

### Activation And Enrollment

Existing foundation:

- `POST /api/it-admin/admin/activation-tokens`
- `GET /api/it-admin/admin/device-enrollments`
- `POST /api/it-admin/admin/device-enrollments/{id}/approve`
- `POST /api/it-admin/admin/device-enrollments/{id}/revoke`

Future v1 facade:

- `POST /api/it-admin/v1/activation-tokens`
- `GET /api/it-admin/v1/device-enrollments`
- `POST /api/it-admin/v1/device-enrollments/{id}/approve`
- `POST /api/it-admin/v1/device-enrollments/{id}/revoke`

Rules:

- raw activation token returned once only
- store hash only
- token one-time and short-lived
- audit create/consume/approve/revoke

### Packages

`GET /api/it-admin/v1/packages`

List package catalog and feature catalog.

`POST /api/it-admin/v1/packages`

Create package.

Payload:

```json
{
  "code": "pro",
  "name": "Pro",
  "monthly_price": 1990,
  "yearly_price": 19900,
  "max_branches": 3,
  "max_devices": 6,
  "max_users": 20,
  "features": {
    "core_pos_sales": true,
    "branch_management": true,
    "inet_nops_qr": true
  }
}
```

`PATCH /api/it-admin/v1/packages/{packageId}`

Update price, limits, status, metadata.

`DELETE /api/it-admin/v1/packages/{packageId}`

Soft deactivate only if tenants still reference it.

### Contracts

Existing route:

- `GET/PATCH /api/it-admin/admin/tenants/{tenantId}/contract`

Future v1:

- `GET /api/it-admin/v1/tenants/{tenantId}/contract`
- `PATCH /api/it-admin/v1/tenants/{tenantId}/contract`
- `POST /api/it-admin/v1/tenants/{tenantId}/contract/cancel`

Rules:

- contract status controls runtime feature availability
- `suspended`, `expired`, `cancelled` disables feature access
- changing package invalidates tenant feature cache
- audit `contract_created`, `contract_updated`, `plan_changed`, `contract_suspended`, `contract_reactivated`

### Features

Existing route:

- `GET/PATCH /api/it-admin/admin/tenants/{tenantId}/features`

Future v1:

- `GET /api/it-admin/v1/features/catalog`
- `GET /api/it-admin/v1/tenants/{tenantId}/features`
- `PATCH /api/it-admin/v1/tenants/{tenantId}/features/{featureCode}`
- `PATCH /api/it-admin/v1/tenants/{tenantId}/branches/{branchId}/features/{featureCode}`

Resolution order must remain:

1. active/trial contract
2. package feature matrix
3. tenant override
4. branch override

Rules:

- feature disable must be enforced server-side, not just UI hidden
- mutation invalidates cache
- audit `feature_enabled` / `feature_disabled`

### Operational Controls

`GET /api/it-admin/v1/tenants/{tenantId}/sessions`

List POS sessions.

`POST /api/it-admin/v1/tenants/{tenantId}/sessions/{sessionId}/revoke`

Revoke unsafe active session.

`GET /api/it-admin/v1/tenants/{tenantId}/shifts`

List shifts.

`POST /api/it-admin/v1/tenants/{tenantId}/shifts/{shiftId}/force-close`

Guarded close only. Must record reason and audit.

`POST /api/it-admin/v1/tenants/{tenantId}/maintenance`

Set tenant/branch maintenance notice. Useful for unstable API/network windows.

### Audit Logs

`GET /api/it-admin/v1/audit-logs`

Filters:

- tenant_id
- branch_id
- actor_user_id
- action
- date_from/date_to
- limit/cursor

Every mutation must write:

- actor
- role
- tenant
- branch where applicable
- action
- target table/id
- before/after where safe
- IP/user-agent
- request id/idempotency key

## Service Layer Recommendation

Do not put large business logic directly inside route handlers.

Create shared services:

- `src/lib/services/it-admin/tenant-admin-service.ts`
- `src/lib/services/it-admin/branch-admin-service.ts`
- `src/lib/services/it-admin/user-admin-service.ts`
- `src/lib/services/it-admin/device-admin-service.ts`
- `src/lib/services/it-admin/package-admin-service.ts`
- `src/lib/services/it-admin/feature-admin-service.ts`
- `src/lib/services/it-admin/admin-summary-service.ts`

Route handlers should:

1. authenticate with `requireItAdmin`
2. parse/validate payload
3. call service
4. return `ok`/`fail`
5. never leak raw SQL errors to public clients in production

## Performance Implementation Plan

Phase 1, before adding more IT screens:

- Add paginated tenant summary endpoint.
- Add DB view/RPC for tenant operational summary.
- Add request timing headers.
- Add API-level slow log when duration exceeds 1500ms.
- Add targeted tests for tenant list pagination and quota blocks.

Phase 2:

- Add v1 facade routes.
- Move existing admin route logic into services.
- Keep old routes as compatibility wrappers.
- Add contract tests for v1 payloads.

Phase 3:

- Add IT Admin UI dashboards.
- Add health/readiness screen.
- Add maintenance controls.
- Add package editor and feature matrix editor.

## Required Tests

Minimum tests before commit/deploy:

- it-admin guard rejects non-it-admin.
- tenant create validates duplicate code.
- branch create enforces package quota.
- device approve enforces package quota.
- feature override invalidates cache.
- contract suspend disables feature access.
- tenant deactivate revokes sessions and blocks devices.
- audit logs are written for every mutation.
- pagination returns stable cursor and no duplicate rows.

## Open Decisions

- Whether to let `support_admin` perform limited session/shift recovery.
- Whether tenant deletion should ever be hard delete. Recommendation: no hard delete from UI; use deactivation/export/retention workflow.
- Whether package catalog changes should require dual approval in production.
- Whether v1 API should support external integration tokens or only authenticated admin sessions.
