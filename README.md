# CpIPOS

CpIPOS is a production-oriented multi-tenant, multi-branch point-of-sale platform for Web POS, Back Office, IT administration, Android POS, and Windows runtime clients.

## Source of truth

- Repository: `sstdevelopaminno/CpIPOS`
- Current integration line: `agent-docs-preflight-schema-drift`
- Web/POS project: `cp-ipos-web`
- GitHub currently receives separately configured Vercel deployment checks for `cp-ipos-web`, `cp-ipos-backoffice-web`, and `cp-ipos-it-admin-web`. Treat these as project-level deployment integrations; do not infer that a project is retired solely because it is not visible through one connector session. The IT Admin routes also exist in `apps/backoffice-web` and must remain covered by the reviewed production build.
- Primary database / control plane: CpiPOS-001, Supabase ref `deejlitaivfnsbwqdugy`
- Trial data plane: CpiPOS-002, Supabase ref `kawenyvpentwgugtzqec`
- Primary guardrails: `docs/AI-GUARDRAILS-CPIPOS.md`
- Trial data-plane runbook: `docs/CPIPOS-TRIAL-DATA-PLANE-2026-08-08.md`
- Production readiness: `docs/production-readiness-checklist.md`
- Go-live evidence: `docs/go-live-evidence-checklist.md`
- Manual QA: `docs/manual-qa-checklist.md`
- Project handoff/context: `context.md`

Read the guardrails before changing authentication, tenant isolation, database routing, POS transactions, payments, printer routing, devices, migrations, or production configuration.

## Repository layout

```text
apps/
  backoffice-web/            # Back Office + IT Admin + Web POS + server APIs + download pages
  cpipos-mobile-android/     # CpIPOS Mobile Native Android
  pos-android/               # Android POS runtime
  windows-runtime-it-admin/  # Windows IT Admin runtime
  windows-runtime-native/    # Windows POS/native runtime
packages/
  shared-types/
  pos-domain/
  ui/
supabase/
  migrations/                # CpiPOS-001 Primary migrations only
  trial-data-plane/
    migrations/              # CpiPOS-002 Trial migrations only
```

Core stack: Next.js, TypeScript, pnpm, Supabase PostgreSQL/Auth/RLS, GitHub Actions, Vercel, Kotlin, Jetpack Compose, and Windows native runtime components.

## Database architecture

### CpiPOS-001 — Primary / Control Plane

CpiPOS-001 is authoritative for:

- Supabase Auth/JWT;
- tenants and public store codes;
- branches, users, and roles;
- devices and login policy;
- POS sessions and shifts;
- tenant lifecycle and data-home routing;
- subscriptions and feature controls;
- IT Admin/control configuration;
- audit/control records;
- INET NOPS payment intent/callback integration records.

Primary migrations belong only in `supabase/migrations/`.

### CpiPOS-002 — Trial Data Plane

CpiPOS-002 stores selected high-churn Trial business data, including:

- products and categories;
- ingredients, recipes, and inventory movements;
- orders, order items, and payments;
- dine-in tables, table sessions, and Table QR business state;
- branch inventory and tax business settings used by those transaction paths.

Trial migrations belong only in `supabase/trial-data-plane/migrations/`.

Never place Trial migrations in the Primary migration folder.

Clients never choose a database. `apps/backoffice-web/src/lib/tenant-data-router.ts` resolves the data plane on the server from trusted CpiPOS-001 lifecycle state. `tenant_data_lifecycle.data_home` is authoritative; `desired_data_home` is not a routing signal.

If a tenant is routed to Trial but Trial routing or credentials are unavailable, the request must fail closed. Never silently fall back to Primary because that can create split-brain writes.

## Security model

CpIPOS is tenant-scoped and server-trusted.

- Never trust client-provided tenant, branch, role, device, or permission scope.
- Keep Primary and Trial service-role credentials server-only.
- Browser and native clients call CpIPOS APIs; they do not receive or select Trial service credentials.
- RLS remains enabled according to the reviewed table security model.
- Privileged POS transaction RPCs are service-role only.
- Device, branch, POS-session, shift, feature, and permission gates remain authoritative.
- Sensitive and financial actions must remain auditable and idempotent where required.
- Table QR anonymous requests resolve their object through server-side routing; the browser does not choose tenant or data home.
- Development authentication fallbacks must never be accepted in production.

Do not weaken RLS, device/session checks, role checks, transaction boundaries, or service-role boundaries to make a failing request pass.

## Transaction baseline

Production defaults are transaction-first and fail closed:

```env
POS_FORCE_DIRECT_CREATE_NON_DELIVERY=false
POS_FORCE_DIRECT_PAYMENT_COMPLETE=false
POS_SOFT_BYPASS_INSUFFICIENT_STOCK=false
```

Rules:

- `create_pos_order_tx` is the authoritative atomic order path.
- `complete_pos_payment_tx` is the authoritative atomic payment path.
- `create_stock_adjustment_tx` is the atomic stock-adjustment path on the Trial data plane.
- Table QR ordering uses a transactional RPC.
- Retry order/payment mutations only with the same idempotency or request key after a timeout.
- Negative-stock behavior is branch policy, not a generic bypass.
- Dine-in/takeaway order-item price is validated at the database boundary against the active catalog price.
- Delivery price differences must use the reviewed server-resolved channel pricing flow.

## Printing and kitchen safety

Printer routing is security- and operations-sensitive.

- Kitchen jobs must resolve only to a kitchen-capable profile/assignment.
- A kitchen assignment must not fall back to an unrelated receipt profile.
- Network printer IP/port values must come from verified configuration; never invent an endpoint.
- Never blindly resend or requeue historical jobs. Reconcile each job against order and deduplication evidence first.
- Keep Print Agent heartbeat/config refresh separate from high-frequency job claiming.
- Idle polling must back off while queue-created wake signals remain responsive.
- Physical printer acceptance is required before declaring a kitchen route production-ready.

## Cross-plane INET NOPS rule

INET provider intent/callback records remain in CpiPOS-001 because provider callbacks arrive without a trusted POS session or tenant route.

`pos_payment_intents.order_id` is a cross-plane UUID, not a same-database foreign key. Server-side validation must verify that the order, tenant, and branch exist either in Primary or through the trusted Trial object-route registry.

Provider credentials/tokens remain server-only. Dynamic provider URLs must be HTTPS and hostname-allowlisted. Duplicate callbacks must remain idempotent.

## Required environment baseline

Start from `apps/backoffice-web/.env.example`.

Primary:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
POS_SESSION_HANDOFF_SECRET=
TABLE_QR_SIGNING_SECRET=
```

Trial data plane:

```env
TRIAL_SUPABASE_URL=https://kawenyvpentwgugtzqec.supabase.co
TRIAL_SUPABASE_SERVICE_ROLE_KEY=
TRIAL_DATA_ROUTING_ENABLED=false
```

`TRIAL_SUPABASE_SERVICE_ROLE_KEY` must never be committed, logged, placed in `NEXT_PUBLIC_*`, or sent to a browser. Keep Trial routing disabled until the production server secret, schema parity, and canary verification are complete.

Production/serverless rate limiting should use the configured distributed backend rather than process-local memory.

## Migration discipline

For Primary changes:

1. Inspect the live CpiPOS-001 schema/state.
2. Create an additive compatible migration.
3. Apply and verify explicitly.
4. Mirror the applied migration/version in `supabase/migrations/`.
5. Run Primary schema drift and CI.

For Trial changes:

1. Inspect the live CpiPOS-002 schema/state.
2. Create an additive Trial migration.
3. Apply and verify security and transaction invariants.
4. Mirror the applied migration/version in `supabase/trial-data-plane/migrations/`.
5. Run Trial schema drift and CI.

Do not blindly replay historical migrations on production projects. Do not add a guessed database column merely to satisfy a caller; fix the source/schema contract from verified evidence.

## CI and verification

Primary workflow: `.github/workflows/ci.yml`.

Required gates for a releasable web/server line are:

- TypeScript typecheck;
- ESLint;
- automated tests;
- CpiPOS-001 schema drift;
- CpiPOS-002 schema drift;
- production build.

Native release workflows add their own architecture/version/build/package gates.

Useful commands:

```powershell
corepack pnpm --filter backoffice-web typecheck
corepack pnpm --filter backoffice-web exec vitest run --cache false
corepack pnpm schema:drift
corepack pnpm schema:drift:trial
corepack pnpm --filter backoffice-web build
```

Do not disable tests, schema drift, or build gates merely to obtain a green status.

## Text and encoding policy

All project source and documentation must be valid UTF-8. Repository text normalization is defined by `.editorconfig` and `.gitattributes`.

- Do not save Thai UI text through a legacy Windows code page.
- Do not commit replacement characters or common UTF-8/Windows-1252 mojibake sequences.
- Fix corrupted source text at the source rather than masking it only at runtime.
- Encoding regression tests must remain enabled in CI.

## Release discipline

Production readiness requires both green automated gates and runtime evidence.

- Use a reviewed repair/feature branch and pull request for changes to the integration line.
- Keep the production/default line protected with required checks when repository settings permit it.
- Do not treat a successful Vercel preview as equivalent to all-system readiness.
- Do not promote while an active P0 release freeze is unresolved.
- Close incident acceptance criteria with real runtime/physical evidence, especially printer and device-command acknowledgements.

Issue #74 remains the operational reference for the current print-stabilization freeze until its acceptance criteria are explicitly completed.

## Performance guidance

Measure workload before broad optimization. Prioritize request amplification and hot polling before speculative database indexes.

- reduce unnecessary polling;
- pause or back off hidden/idle clients;
- coalesce concurrent refreshes;
- avoid N+1 mutations and repeated scope lookups;
- avoid unnecessary internal HTTP hops within the same deployment;
- preserve heartbeat and safety semantics;
- add or remove indexes only with query evidence / EXPLAIN data.

## Documentation

Current references include:

- `docs/AI-GUARDRAILS-CPIPOS.md`
- `docs/CPIPOS-TRIAL-DATA-PLANE-2026-08-08.md`
- `docs/DATABASE-HOUSEKEEPING-2026-08-07.md`
- `docs/ACTIVE-DOCS-INDEX.md`
- `docs/INET-NOPS-QR-OPERATIONS-MANUAL.md`
- `docs/production-readiness-checklist.md`
- `docs/go-live-evidence-checklist.md`
- `docs/manual-qa-checklist.md`
- `context.md`

Current behavior and security decisions are governed by verified live schema, the latest reviewed migrations, CI/tests, this README, and `docs/AI-GUARDRAILS-CPIPOS.md`.
