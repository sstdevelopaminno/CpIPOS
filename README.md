# CpIPOS

Production-oriented multi-tenant / multi-branch POS platform.

## Current source of truth

- Repository: `sstdevelopaminno/CpIPOS`
- Active integration branch: `agent-docs-preflight-schema-drift`
- Web/POS production project: `cp-ipos-web`
- Mobile production project: `cp-ipos-mobile`
- Supabase project: `POS-Preview`
- Supabase ref: `deejlitaivfnsbwqdugy`
- Primary guardrails: `docs/AI-GUARDRAILS-CPIPOS.md`
- Database housekeeping baseline: `docs/DATABASE-HOUSEKEEPING-2026-08-07.md`
- Historical handoff: `docs/CPIPOS-HANDOFF-2026-07-28.md`

Before changing authentication, tenant isolation, database schema, POS transactions, payment flows, devices, or production configuration, read `docs/AI-GUARDRAILS-CPIPOS.md` first.

## Architecture

```text
tenant
  -> branches
      -> branch devices/registers
      -> users + user_branch_roles
      -> shifts
      -> orders / order_items / payments
      -> products / recipes / ingredients / stock movements
```

Applications:

```text
apps/
  backoffice-web/            # Back Office + IT Admin + Web POS + APIs
  pos-mobile-web/            # Mobile web runtime
  pos-android/               # Android runtime
  windows-runtime-it-admin/  # Windows IT Admin runtime
  windows-runtime-native/    # Windows POS/native runtime

packages/
  shared-types/
  pos-domain/
  ui/

supabase/
  migrations/
  seed.sql
```

Core stack:

- Next.js / TypeScript
- pnpm monorepo
- Supabase PostgreSQL + Auth + RLS
- GitHub Actions
- Vercel

## Security model

CpIPOS is tenant-scoped and server-trusted.

- Never trust client-provided `tenant_id`, `branch_id`, device scope, role, or permission as authoritative.
- Resolve trusted scope from authenticated server/POS session state.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only.
- Browser/mobile public clients use only the public Supabase key and server APIs designed for them.
- RLS remains enabled for client-reachable tables.
- Privileged POS transaction RPCs are server/service-role only.
- Device registration and branch/device scope enforcement remain active.
- Shift gate and permission gates remain active before sales operations.
- Audit logs are retained for security-sensitive and financial actions.
- Login/session tokens are opaque, short-lived where applicable, scope checked, and replay protected.

Do not weaken tenant/branch/device/RLS boundaries merely to make a failing request pass.

## Production database baseline

The Production business-data baseline is intentionally limited to the approved current tenants documented in `docs/AI-GUARDRAILS-CPIPOS.md`.

Important rules:

- The deleted legacy tenant `SOLO-TH-001` must not be recreated from default seed/reset paths.
- Package code `solo` / `Solo Register` is a valid global subscription package and is not a tenant.
- `supabase/seed.sql` is intentionally tenant-neutral.
- Default reset must not create demo tenants, branches, auth users, employee codes, passwords, PINs, devices, products, orders, tables, or inventory.
- Demo/test fixtures, if needed, must live in explicit opt-in scripts outside the default reset path.
- Do not add known/default credentials to this README or to `supabase/seed.sql`.

Current housekeeping migrations include:

```text
20260807152000_add_safe_scope_lookup_indexes
20260807154613_optimize_rls_auth_initplan_phase2
20260807155636_restrict_service_only_security_definer_rpcs
20260807155747_lock_app_function_search_paths
20260807155904_add_hot_relationship_indexes_phase2
20260807164920_restrict_authenticated_helper_policies
```

The schema-drift CI check protects this baseline.

## POS login flow

Current pre-entry flow:

```text
/login/store
  -> /login/branches   (when branch selection is required)
  -> /login/employee
  -> /login/devices
  -> /preview/pos
```

Server APIs resolve store/tenant/branch/device/session scope. The client must not be treated as the authority for these values.

Typical unauthenticated expectations:

- `/preview/pos` redirects to login without a valid POS session.
- `/api/pos/session/current` returns an authentication error without a valid POS session.
- `/api/pos/features` returns an authentication error without a valid POS session.
- sales/payment mutations require a valid POS session, active shift where required, device policy, feature policy, and permission checks.

## Transaction and idempotency baseline

Order creation and payment completion are transaction-first.

Production defaults:

```env
POS_FORCE_DIRECT_CREATE_NON_DELIVERY=false
POS_FORCE_DIRECT_PAYMENT_COMPLETE=false
POS_SOFT_BYPASS_INSUFFICIENT_STOCK=false
```

Rules:

- `create_pos_order_tx` is the authoritative atomic order-creation path.
- `complete_pos_payment_tx` is the authoritative atomic payment-completion path.
- Direct multi-request fallbacks are emergency compatibility paths only and must never become the silent default.
- Negative-stock behavior is controlled by branch-aware database policy, not a generic application bypass.
- If an API timeout occurs, the database request may still finish. Retry money/order mutations only with the same idempotency/request key.
- Never automatically retry a money-changing external provider request unless the provider contract explicitly guarantees safe idempotency.

## API reliability baseline

### Internal APIs

- Avoid server-to-server HTTP calls back into the same Next.js deployment when the shared handler/service can be called in-process.
- Bound external network operations with timeouts.
- Keep auth/session/feature resolution single-flight or cached only where security semantics remain unchanged.
- Prefer transaction RPCs or bounded batch operations over N+1 mutation loops.
- Do not expose raw Supabase/provider errors or secrets to the browser.

### Rate limiting

Local development may use process memory:

```env
RATE_LIMIT_BACKEND=memory
```

Production/serverless should use distributed Upstash:

```env
RATE_LIMIT_BACKEND=upstash
RATE_LIMIT_BACKEND_TIMEOUT_MS=2500
RATE_LIMIT_REDIS_PREFIX=sstipos
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

There is no Redis TCP backend implementation in the current application. Do not set `RATE_LIMIT_BACKEND=redis`.

High-risk authentication endpoints may fail closed when the configured distributed backend is unavailable. Other flows may degrade to process-local memory only where explicitly designed.

## External payment API: INET NOPS

INET NOPS QR is optional. Manual PromptPay / configured QR image / bank-transfer workflows remain separate.

Server-only configuration uses variables such as:

```env
INET_NOPS_ENV=uat
INET_NOPS_MERCHANT_KEY_UAT=
INET_NOPS_MERCHANT_ID_UAT=
INET_NOPS_OAUTH_URL_UAT=https://new-ops-poc.inet.co.th/uat/oauth/api/v1/oauth-token
INET_NOPS_ACCESS_TOKEN_URL_UAT=https://new-ops-poc.inet.co.th/uat/api/v1/sandbox/payment-transactions/access-token
INET_NOPS_ALLOWED_PAYMENT_HOSTS_UAT=
INET_NOPS_AP_URL_UAT=https://YOUR_DOMAIN/payment/inet/result
INET_NOPS_CALLBACK_PUBLIC_URL=https://YOUR_DOMAIN/api/payments/inet/callback
```

Production credentials and URLs use the corresponding `_PROD` variables.

Security/reliability rules:

- Merchant keys and provider access tokens stay server-only.
- Provider OAuth/access-token/payment requests have bounded timeouts.
- Provider-supplied dynamic payment URLs must be HTTPS.
- Dynamic payment hostname must match a configured trusted provider endpoint hostname or an explicit `INET_NOPS_ALLOWED_PAYMENT_HOSTS_*` allowlist entry.
- Callback settlement validates the pending payment intent, provider order ID, merchant, amount, and payment event/result before financial finalization.
- Duplicate callbacks must remain idempotent.
- Do not invent a provider signature header unless INET's official contract specifies one; provider-authentication changes require a contract-backed integration test.

Operational details: `docs/INET-NOPS-QR-OPERATIONS-MANUAL.md`.

## Required environment

Start from:

`apps/backoffice-web/.env.example`

Core production variables include:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
POS_SESSION_HANDOFF_SECRET=
TABLE_QR_SIGNING_SECRET=
```

Use strong, distinct secrets. Never commit `.env.local`, Vercel tokens, Supabase access tokens, service-role keys, provider merchant keys, or database passwords.

## Local setup

Requirements:

- Node `>=22 <25`
- pnpm `10.33.4`
- Supabase CLI when running local database workflows

Install:

```bash
pnpm install
```

Create local environment:

```text
apps/backoffice-web/.env.example
  -> apps/backoffice-web/.env.local
```

Run:

```bash
pnpm dev
```

Do not expect the default seed to create a ready-made demo store. Provision test tenants/users/devices explicitly in a controlled development environment.

## Database migration workflow

Review migrations before applying them to Production.

Do not run broad historical migration replay commands blindly on Production because the repository contains legacy migration history and previous drift.

For new changes:

1. Inspect current Production schema/state.
2. Create an additive migration.
3. Apply and verify invariants.
4. Mirror the exact migration into `supabase/migrations`.
5. Update schema-drift requirements where the change is part of the protected baseline.
6. Run CI and production build.
7. Verify deployment and Supabase advisors.

Never rename live tables/RPCs/policies merely for style without compatibility analysis.

## Verification

Primary CI workflow:

```text
.github/workflows/ci.yml
```

Expected checks include:

- Web TypeScript
- Web lint
- Web tests
- Schema drift preflight
- Web production build
- Mobile TypeScript
- Mobile lint
- Mobile tests
- Mobile build

Useful local commands:

```powershell
corepack pnpm --filter backoffice-web typecheck
corepack pnpm --filter backoffice-web exec vitest run --cache false
corepack pnpm --filter backoffice-web exec eslint src scripts tests next.config.ts eslint.config.mjs --cache --cache-location ..\..\.tmp-eslintcache --no-error-on-unmatched-pattern
corepack pnpm schema:drift
corepack pnpm --filter backoffice-web build
```

## Performance guidance

Production profiling shows the PostgreSQL engine is generally fast; request amplification and repeated API round-trips are a more important optimization target than indiscriminately adding indexes.

Priorities:

- reduce repeated session/shift/order polling where correctness permits;
- use single-flight/cache boundaries for repeated auth/feature resolution without changing permission semantics;
- reduce N+1 updates in order/payment metadata enrichment;
- avoid unnecessary internal HTTP hops;
- keep customer-display and print-agent liveness writes deliberate because their timestamps are operational signals;
- add FK indexes only when workload/cardinality/relationship operations justify them;
- do not delete indexes merely because an Advisor reports `unused_index` shortly after deployment.

## Supabase Advisor notes

Some Advisor entries are intentionally not zero:

- `RLS Enabled No Policy` on server-only tables can be correct deny-by-default behavior.
- `Multiple Permissive Policies` requires permission-equivalence testing before merging policies.
- `Unindexed Foreign Keys` are reviewed against workload rather than mass-created.
- `Unused Index` requires a meaningful observation window before removal.
- Supabase Auth `Leaked Password Protection` should be enabled in the project Auth settings before customer onboarding when the project plan supports it.

## Documentation

Current operational references:

- `docs/AI-GUARDRAILS-CPIPOS.md`
- `docs/DATABASE-HOUSEKEEPING-2026-08-07.md`
- `docs/ACTIVE-DOCS-INDEX.md`
- `docs/INET-NOPS-QR-OPERATIONS-MANUAL.md`
- `docs/POS-SHIFT-CLOSE-RELIABILITY-2026-07-10.md`
- `docs/POS-LOGIN-ARCHITECTURE-PHASE-NEXT.md`
- `docs/POS-LOGIN-POS-BRIDGE-E2E-CHECKLIST.md`
- `docs/production-readiness-checklist.md`
- `docs/go-live-evidence-checklist.md`
- `docs/manual-qa-checklist.md`
- `context.md`

Historical/archive documents are reference material only. Current behavior and security decisions are governed by the latest migrations, tests, `README.md`, and `docs/AI-GUARDRAILS-CPIPOS.md`.

## Production change discipline

Before customer data is present:

- finish configuration verification;
- keep tenant/branch/device/RLS isolation intact;
- keep transaction/idempotency paths authoritative;
- enable supported Auth security controls;
- keep distributed rate limiting configured;
- confirm backups/restore and rollback procedures.

After customer data is present:

- prefer additive, backward-compatible migrations;
- do not perform destructive cleanup without an explicit backup/rollback plan;
- measure real workload before index/polling changes;
- treat financial/payment and tenant-isolation changes as high-risk and require regression evidence.