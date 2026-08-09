# CpIPOS

Production-oriented multi-tenant / multi-branch POS platform.

## Current source of truth

- Repository: `sstdevelopaminno/CpIPOS`
- Active integration branch: `agent/web-android-0.2.2-integration`
- Web/POS Vercel project: `cp-ipos-web`
- CpIPOS Mobile distribution: Native Android APK via GitHub Releases + `/download/mobile` on `cp-ipos-web`; there is no Mobile web runtime in the repository
- **CpiPOS-001 / Primary:** Supabase ref `deejlitaivfnsbwqdugy`
- **CpiPOS-002 / Trial Data Plane:** Supabase ref `kawenyvpentwgugtzqec`
- Primary guardrails: `docs/AI-GUARDRAILS-CPIPOS.md`
- Trial data-plane status/runbook: `docs/CPIPOS-TRIAL-DATA-PLANE-2026-08-08.md`
- Database housekeeping: `docs/DATABASE-HOUSEKEEPING-2026-08-07.md`
- Historical handoff: `docs/CPIPOS-HANDOFF-2026-07-28.md`
- Web + Android runtime handoff: `docs/CpIPOS_WEB_ANDROID_RUNTIME_HANDOFF_2026-08-10.md`

Read the guardrails before changing authentication, tenant isolation, database routing, POS transactions, payments, devices, migrations or production configuration.

## Applications

```text
apps/
  backoffice-web/            # Authoritative Web App: Back Office + IT Admin + customer POS UI + server APIs + APK download pages
  cpipos-mobile-android/     # CpIPOS Mobile Native Android (Kotlin + Jetpack Compose, no WebView)
  pos-android/               # Android Tablet 0.2.2 thin WebView runtime: MDM, native bridge, diagnostics, future hardware
  windows-runtime-it-admin/  # Windows IT Admin runtime - postponed, not current release target
  windows-runtime-native/    # Windows POS/native runtime - postponed, not current release target
packages/
  shared-types/
  pos-domain/
  ui/
```

CpIPOS Mobile is not a separately hosted web application. Customer distribution uses:

```text
/download/mobile          # customer-facing APK download landing page
/download/mobile/latest   # redirects to the latest CpIPOS-Mobile.apk release asset
```

Core stack: Next.js / TypeScript, pnpm, Supabase PostgreSQL/Auth/RLS, GitHub Actions, Vercel, Kotlin for native Mobile and Android runtime shell.
Current architecture checkpoint:

- CpIPOS Web App is the authoritative customer UI and business frontend.
- Android Tablet 0.2.2 is a thin WebView runtime. It owns MDM, native bridge, diagnostics, and future device/hardware capability work, not duplicate native POS business UI.
- Windows runtime work is postponed and is not the current release target.

Resume current Web/Android runtime work from `context.md`, `docs/CpIPOS_MASTER_SYSTEM_SCOPE.md`, and `docs/CpIPOS_WEB_ANDROID_RUNTIME_HANDOFF_2026-08-10.md`.

## Database architecture

### CpiPOS-001 — Primary / Control Plane

CpiPOS-001 remains authoritative for:

- Supabase Auth/JWT;
- tenants and public store codes;
- branches, users and roles;
- devices/login policy;
- POS sessions and shifts;
- tenant lifecycle/data-home routing;
- subscriptions/features;
- IT Admin/control configuration;
- audit/control records;
- INET NOPS payment intent/callback integration records.

Primary migrations live only in:

```text
supabase/migrations/
```

### CpiPOS-002 — Trial Data Plane

CpiPOS-002 stores selected high-churn Trial business data:

- product/category catalog;
- ingredients/recipes/inventory movements;
- orders/order items/payments;
- dine-in tables/table sessions/Table QR business state;
- branch inventory/tax business settings used by those transaction paths.

Trial migrations live only in:

```text
supabase/trial-data-plane/migrations/
```

Never put Trial migrations into the Primary migration folder.

Clients never choose a database. `apps/backoffice-web/src/lib/tenant-data-router.ts` resolves the server data plane from trusted CpiPOS-001 lifecycle state. `tenant_data_lifecycle.data_home` is authoritative; `desired_data_home` is not a routing signal.

If a tenant is marked `data_home=trial` but Trial routing or credentials are unavailable, the request fails closed. Do not silently fall back to Primary because that can create split-brain writes.

## Security model

CpIPOS is tenant-scoped and server-trusted.

- Never trust client-provided tenant, branch, role, device or permission scope.
- Keep Primary and Trial service-role credentials server-only.
- Browser/mobile clients call CpIPOS APIs; they do not receive or select CpiPOS-002 credentials.
- RLS remains enabled for client-reachable or server-only protected tables as designed.
- Privileged POS transaction RPCs are service-role only.
- Device, branch, POS-session, shift, feature and permission gates remain authoritative.
- Sensitive/financial actions remain auditable and idempotent where required.
- Table QR anonymous requests resolve their QR-session object through the server-side routing registry; the browser does not choose tenant/data home.

Do not weaken RLS, device/session checks or service-role boundaries to make a failing request pass.

## Transaction baseline

Order creation and payment completion are transaction-first:

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
- Retry order/payment mutations only with the same idempotency/request key after a timeout.
- Negative-stock behavior is branch policy, not a generic bypass.
- Dine-in/takeaway order-item price is enforced at the database boundary against the active catalog price; a modified client `unit_price` is rejected.
- Delivery prices may differ from catalog only through the reviewed server-resolved channel pricing flow.

## Cross-plane INET NOPS rule

INET provider intent/callback records remain CpiPOS-001 because provider callbacks arrive without a trusted POS session/tenant route.

`pos_payment_intents.order_id` is therefore a cross-plane UUID, not a same-database FK. Database trigger validation checks that order/tenant/branch exists either as a Primary order or in the server-only `tenant_data_object_routes` registry for a Trial order.

Provider credentials/tokens remain server-only. Dynamic provider URLs must be HTTPS and hostname-allowlisted. Duplicate callbacks remain idempotent.

## Required production environment

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

`TRIAL_SUPABASE_SERVICE_ROLE_KEY` must never be committed, logged, placed in `NEXT_PUBLIC_*`, or sent to a browser. Keep `TRIAL_DATA_ROUTING_ENABLED=false` until the production server secret and final canary are verified.

Production/serverless auth rate limiting should use distributed Upstash:

```env
RATE_LIMIT_BACKEND=upstash
RATE_LIMIT_BACKEND_TIMEOUT_MS=2500
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

There is no Redis TCP backend implementation; do not set `RATE_LIMIT_BACKEND=redis`.

## Seed / tenant safety

- `supabase/seed.sql` must stay tenant-neutral.
- Do not put production/demo tenants, branches, devices, users, passwords, PINs, products, orders or inventory in the default seed.
- Deleted `SOLO-TH-001` must not be recreated.
- Package code `solo` / `Solo Register` is a valid global package and is not the deleted tenant.
- Demo/test fixtures must be explicit opt-in scripts.

## Migration workflow

For Primary changes:

1. inspect CpiPOS-001 state;
2. create an additive compatible migration;
3. apply and verify;
4. mirror the exact migration/version in `supabase/migrations/`;
5. run Primary schema drift and CI.

For Trial changes:

1. inspect CpiPOS-002 state;
2. create an additive Trial migration;
3. apply and verify security/transaction invariants;
4. mirror the exact migration/version in `supabase/trial-data-plane/migrations/`;
5. run `schema:drift:trial` and CI.

Do not blindly replay historical migrations on production projects.

## CI / verification

Primary web/server workflow: `.github/workflows/ci.yml`.
CpIPOS Mobile Native Android build/release workflow: `.github/workflows/build-cpipos-mobile-android.yml`.

Expected gates:

- Web TypeScript
- Web lint
- Web tests
- CpiPOS-001 schema drift
- CpiPOS-002 schema drift
- Web production build
- Native Android architecture/version validation
- Native Android APK build
- APK artifact/release publication on eligible runs

Useful commands:

```powershell
corepack pnpm --filter backoffice-web typecheck
corepack pnpm --filter backoffice-web exec vitest run --cache false
corepack pnpm schema:drift
corepack pnpm schema:drift:trial
corepack pnpm --filter backoffice-web build
```

The retired `pos-mobile-web` package and its `*:mobile` pnpm scripts must not be reintroduced. Mobile customer distribution is APK-first through `/download/mobile`.

## Trial cutover discipline

Until the server-only CpiPOS-002 credential is confirmed in Vercel, current Trial tenants remain authoritative on Primary even if a verified snapshot exists on CpiPOS-002.

Cutover sequence:

1. keep `data_home=primary` while configuring server Trial credentials;
2. run final delta copy and reconciliation;
3. refresh object-route registry;
4. canary `TEST-TH-003` first;
5. verify session/shift, catalog, inventory, order, payment, receipt/print, Table QR, provider payment path where enabled, retries and outage fail-closed behavior;
6. then cut over `BBQ-TH-002`;
7. keep `NDL-TH-001` Primary;
8. retain an explicit cutback/reconciliation plan.

Detailed evidence/runbook: `docs/CPIPOS-TRIAL-DATA-PLANE-2026-08-08.md`.

## Performance guidance

Measure workload before broad optimization. Current priorities are request/round-trip amplification rather than indiscriminate index creation:

- reduce unnecessary polling;
- keep auth/feature resolution single-flight where security semantics are unchanged;
- remove N+1 mutations in sales enrichment;
- avoid internal HTTP hops inside the same Next.js deployment;
- preserve operational heartbeat semantics for print/customer-display systems;
- add/remove indexes only with workload evidence.

## Supabase Advisor notes

Not every Advisor INFO/WARN should be mechanically silenced.

- `RLS Enabled No Policy` is expected on deliberate server-only deny-by-default tables.
- `Multiple Permissive Policies` requires permission-equivalence testing before consolidation.
- `Unindexed Foreign Keys` and `Unused Index` require workload evidence.
- Enable Supabase Auth Leaked Password Protection before customer onboarding when the project plan supports it.

## Documentation

Current references:

- `docs/AI-GUARDRAILS-CPIPOS.md`
- `docs/CPIPOS-TRIAL-DATA-PLANE-2026-08-08.md`
- `docs/DATABASE-HOUSEKEEPING-2026-08-07.md`
- `docs/ACTIVE-DOCS-INDEX.md`
- `docs/INET-NOPS-QR-OPERATIONS-MANUAL.md`
- `docs/production-readiness-checklist.md`
- `docs/go-live-evidence-checklist.md`
- `docs/manual-qa-checklist.md`
- `context.md`

Current behavior/security decisions are governed by the latest migrations, CI/tests, this README and `docs/AI-GUARDRAILS-CPIPOS.md`.