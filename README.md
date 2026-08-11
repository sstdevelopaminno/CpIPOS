# CpIPOS

Production-oriented multi-tenant / multi-branch POS platform.

## Current source of truth

- Repository: `sstdevelopaminno/CpIPOS`
- Active integration branch: `agent-docs-preflight-schema-drift`
- Web/POS Vercel project: `cp-ipos-web`
- CpIPOS Mobile distribution: Native Android APK via GitHub Releases + `/download/mobile` on `cp-ipos-web`; there is no Mobile web runtime in the repository
- **CpiPOS-001 / Primary:** Supabase ref `deejlitaivfnsbwqdugy`
- **CpiPOS-002 / Trial Data Plane:** Supabase ref `kawenyvpentwgugtzqec`
- Primary guardrails: `docs/AI-GUARDRAILS-CPIPOS.md`
- Trial data-plane status/runbook: `docs/CPIPOS-TRIAL-DATA-PLANE-2026-08-08.md`
- Database housekeeping: `docs/DATABASE-HOUSEKEEPING-2026-08-07.md`
- Table Management UI/UX checkpoint: `docs/TABLE-MANAGEMENT-UI-CLEANUP-2026-08-11.md`
- Product Management UI/UX checkpoint: `docs/PRODUCT-MANAGEMENT-UI-CLEANUP-2026-08-11.md`
- Historical handoff: `docs/CPIPOS-HANDOFF-2026-07-28.md`

Read the guardrails before changing authentication, tenant isolation, database routing, POS transactions, payments, devices, migrations or production configuration.

## Task #44 source readiness

- Branch `agent/table-order-concurrency-dinein-sync` hardens Table QR read/write rate-limit lanes, lightweight status polling, dine-in queued bill sync, and empty open-bill cancellation.
- Database changes are source migrations only: Primary `20260810075709_table_order_concurrency_dinein_sync.sql` and Trial mirror `20260810075709_trial_table_order_concurrency_dinein_sync.sql`. Do not treat these as applied until an explicit migration-apply task runs.

## Table Management UI/UX checkpoint — 2026-08-11

- Table Management LIST view now has one visual content frame rather than nested borders.
- LIST rows use bounded scrolling and 10-table client pagination with Previous / page count / Next controls.
- Added system-wide bulk table creation for 5–100 tables with presets 5/10/20, branch/zone/seats/start-number/prefix/name-mode inputs, preview, duplicate validation, and one-batch insert semantics.
- Bulk creation remains server-authorized by tenant/branch scope and table-management role, and emits one `table_bulk_create` audit event per successful batch.
- BOARD remains full-list and is not paginated by LIST presentation logic.
- The POS terminal is a primary test device only; these changes apply to the shared Web POS system.
- Detailed acceptance notes: `docs/TABLE-MANAGEMENT-UI-CLEANUP-2026-08-11.md`.

## Product Management UI/UX checkpoint — 2026-08-11

- `/preview/pos/stock` now places Best Sellers, Search/Filter, Manage Categories, Unit Stock, and Stock Settings in the top page header while preserving their existing client state/popups through a React portal.
- Removed the old 60-product query cap so the selected branch can expose the complete product result returned by Supabase instead of silently stopping at 60.
- Product and ingredient lists use 10 rows per client page with bounded vertical scrolling, sticky table headers, visible range text, Previous / page count / Next controls, and page-1 reset after filter/mode changes.
- No database migration or sales/order/payment/shift transaction logic changed.
- The Android POS terminal remains the primary test device only; these are shared Web POS behaviors.
- Detailed acceptance notes: `docs/PRODUCT-MANAGEMENT-UI-CLEANUP-2026-08-11.md`.

## Applications

```text
apps/
  backoffice-web/            # Back Office + IT Admin + Web POS + server APIs + APK download pages
  cpipos-mobile-android/     # CpIPOS Mobile Native Android (Kotlin + Jetpack Compose, no WebView)
  pos-android/               # Android POS runtime
  windows-runtime-it-admin/  # Windows IT Admin runtime
  windows-runtime-native/    # Windows POS/native runtime
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

Core stack: Next.js / TypeScript, pnpm, Supabase PostgreSQL/Auth/RLS, GitHub Actions, Vercel, Kotlin and Jetpack Compose.

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
- `docs/TABLE-MANAGEMENT-UI-CLEANUP-2026-08-11.md`
- `docs/PRODUCT-MANAGEMENT-UI-CLEANUP-2026-08-11.md`
- `docs/ACTIVE-DOCS-INDEX.md`
- `docs/INET-NOPS-QR-OPERATIONS-MANUAL.md`
- `docs/production-readiness-checklist.md`
- `docs/go-live-evidence-checklist.md`
- `docs/manual-qa-checklist.md`
- `context.md`

Current behavior/security decisions are governed by the latest migrations, CI/tests, this README and `docs/AI-GUARDRAILS-CPIPOS.md`.

## Product Management header tabs + pagination follow-up — 2026-08-11

- Moved the existing `All / Unit Only / Ingredients` mode tabs into the top Stock Management action toolbar; the same React state and handlers remain authoritative.
- Removed the redundant `Product List` / `รายการสินค้า` heading from the body.
- Reduced the bounded product/ingredient table height from `56vh` to `45vh` and tightened pagination spacing so Previous / Page / Next sits higher on POS-class 1365x768 displays.
- Pagination remains 10 rows per page and no catalog, stock mutation, sales, receipt, shift, payment, tenant, or branch authorization logic changed.
- This is system-wide Web POS behavior; the physical POS terminal is the primary acceptance-test device only.

## Product Media v1 — 2026-08-11

- Added canonical product-image storage on **CpiPOS-001 Primary** so the same published media can be used for both Primary- and Trial-routed product IDs without exposing Trial credentials to clients.
- New Storage bucket `product-media` is public-read for customer-facing menu images, WebP-only, with server-side writes/deletes through the service role. Asset metadata lives in server-only `product_media_assets` with RLS enabled and no anon/authenticated table privileges.
- Package/contract media quotas are enforced atomically by `upsert_product_media_asset_tx`: Starter = 250 MB Cloud + 1 GB POS cache, Growth = 1 GB Cloud + 4 GB POS cache, Custom default = 5 GB Cloud + 16 GB POS cache. Contract metadata can override either allowance.
- `/preview/pos/stock/media` provides Owner/Manager upload, replace and delete controls. Source JPG/PNG/WebP up to 20 MB is center-cropped to 1:1 and optimized client-side to WebP: display up to 1200px and thumbnail up to 400px before upload.
- **Cloud Published** is the source of truth and is visible on Web POS, POS Sales and customer Table QR. **POS Local Cache** is an additional best-effort CacheStorage copy capped by the package device-cache allowance; cache failure never blocks sales and local-only media is not treated as QR-visible media.
- POS product cards now use published thumbnails and registered POS sessions can warm/read the local media cache. Table QR menu responses include published image URLs; image lookup is fail-soft so media failure cannot block menu/order flow.
- Product media mutations are tenant/branch scoped from trusted POS session data, require Owner/Manager, verify the product on its routed data plane, and emit audit events. The browser never chooses a tenant, data plane, or service-role credential.
- Migration `20260811072000_product_media_v1.sql` was applied to CpiPOS-001 and verified for Storage configuration, RLS, service-role-only RPC execution and quota behavior. No product/order/payment/shift/stock transaction semantics changed.


## Product Media UI follow-up — 2026-08-11

- `/preview/pos/stock/media` hides the three storage-summary cards by default and exposes a `Show Summary / Hide Summary` toggle without changing quota calculations.
- Product-image rows use a POS-friendly bounded vertical scroll area and 10 items per page with visible range text plus Previous / Page / Next controls.
- Search resets the media list to page 1; changing pages scrolls the list container back to the top.
- Upload activation uses a real button backed by one shared file input with `showPicker()` and `.click()` fallback for better Web/POS wrapper compatibility.
- Upload/replace/delete APIs, Cloud quota rules, POS cache behavior, Web POS sales images and Table QR media behavior remain unchanged.
- PR #50 passed Typecheck, Lint, Tests, Primary schema drift, Trial schema drift and PR production build before merge.

## Android POS 1.0.0 / Product Media final UI checkpoint — 2026-08-11

- Product Media promotes the summary toggle into the header on POS/desktop screens, removes the nested inner frame, and reduces the bounded list height so Previous / Page / Next is surfaced earlier on 1365x768 terminals.
- Android Tablet POS is version 1.0.0 (versionCode 6) with Android System Document Picker support for Photos / Files / Google Drive, scoped storage, Bluetooth/Nearby/network/USB printer readiness, Device Admin / Device Owner enrollment foundation, and Web App launcher icon parity.
- Broad All-files access and destructive unaudited MDM commands remain intentionally disabled. Full Device Owner provisioning, staged signed updates, rollback, and destructive policy authorization belong to the next IT Admin control-plane phase.
- Detailed checkpoint: `docs/ANDROID-POS-1.0.0-RELEASE-2026-08-11.md`.

## 2026-08-11 — Dine-in payment return + Table QR customer recipe choices

- Fixed dine-in receipt close behavior: after a paid table receipt is closed (cash or bank transfer), POS returns to the table browser instead of staying inside the settled table.
- Table QR submitted-order history is hidden from normal menu flow and opened from a receipt icon beside the table badge.
- Table QR action success/failure notifications use transient toast messages; fatal QR/menu load failures remain inline.
- Product edit now has `สำหรับลูกค้าเลือก` / `Customer selectable` beside ingredient recipe mode.
- When enabled, Table QR opens a checkbox-only recipe ingredient picker. Customer selections do not change product price or recipe quantities and are persisted as the order-item note for downstream kitchen/printing work.
- Added `products.customer_ingredient_selection_enabled` migration; default is `false`.
- Scope intentionally excludes Kitchen PR #47 and printer logic.

## 2026-08-11 — MDM telemetry profile hardening

- MDM health derivation now distinguishes Windows Runtime, Android, and plain browser heartbeat profiles before evaluating runtime/peripheral incidents.
- Browser/Android heartbeats no longer produce false `runtime_offline`, `local_bridge_offline`, `printer_missing`, `printer_error`, print-queue, or drawer incidents when those telemetry capabilities are not present.
- Windows Runtime heartbeat behavior remains strict: Local Bridge, printer, print queue, and drawer failures still generate MDM incidents.
- Browser heartbeat no longer writes page uptime into `latency_ms`; uptime is retained separately as `metadata.heartbeat_uptime_ms` and `latency_ms` stays unknown until a real network RTT measurement exists.
- Added unit regression coverage for browser, Android, and Windows Runtime MDM profiles.
