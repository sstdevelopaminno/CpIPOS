# CpiPOS Trial Data Plane Status

Date: 2026-08-08

## Database Roles

- `CpiPOS-001` (`deejlitaivfnsbwqdugy`) is Primary and remains the identity/control-plane authority.
- `CpiPOS-002` (`kawenyvpentwgugtzqec`) is the Trial Data Plane for high-churn business data.
- Clients never select a Supabase project. Web, Mobile, Android and Windows continue to call CpIPOS server APIs.
- Supabase Auth/JWT, tenant lifecycle, public store codes, users/roles, device/login policy, POS sessions, shifts, subscription/config authority and IT Admin remain in CpiPOS-001.
- `tenant_data_lifecycle.data_home` is the only routing authority. `desired_data_home` never routes traffic by itself.

## Server Data Router

Implemented in:

- `apps/backoffice-web/src/lib/tenant-data-router.ts`
- `apps/backoffice-web/src/lib/supabase-admin.ts`

Behavior:

- control-plane tables/RPCs always use CpiPOS-001;
- selected catalog/inventory/order/payment/table/QR business tables route by trusted tenant lifecycle;
- `data_home=primary` uses CpiPOS-001;
- `data_home=trial` requires `TRIAL_DATA_ROUTING_ENABLED=true` and server-only CpiPOS-002 credentials;
- missing Trial routing configuration fails closed; there is no silent fallback to Primary;
- tenant/branch scope anchors are synchronized from CpiPOS-001 to CpiPOS-002;
- order/payment/Table QR transactions require a short-lived runtime lease derived from a valid CpiPOS-001 POS session and open shift;
- anonymous Table QR requests resolve the QR-session UUID through the server-only `tenant_data_object_routes` registry before selecting a data plane;
- new Trial object IDs are registered back into CpiPOS-001 so callbacks and unscoped object lookups can resolve the authoritative tenant safely.

The dynamic Supabase adapter is intentionally contained at one boundary. The rest of the codebase retains the pre-existing Supabase client type surface.

## CpiPOS-002 Migrations

Source path: `supabase/trial-data-plane/migrations/`

- `20260807190055_trial_data_plane_foundation_v1.sql`
  - scope anchors and runtime leases
  - catalog/inventory
  - orders/order items/payments
  - dine-in/table QR business tables
  - tenant/branch composite integrity
  - RLS deny-by-default
- `20260807190418_trial_data_plane_transactions_v1.sql`
  - atomic order creation and stock deduction
  - atomic payment completion and idempotency
  - Table QR transaction flow
  - service-role-only privileged RPCs
- `20260807193916_enforce_non_delivery_catalog_unit_price.sql`
  - dine-in/takeaway unit price must match active catalog price
  - rejects tampered client price
  - delivery channel pricing remains server-resolved
- `20260807193945_add_trial_stock_adjustment_transaction.sql`
  - atomic stock adjustment
  - request-id idempotency
  - branch negative-stock policy enforcement

## CpiPOS-001 Routing / Cross-Plane Migrations

- `20260807193844_add_tenant_data_object_route_registry.sql`
- `20260807193901_enforce_non_delivery_catalog_unit_price.sql`
- `20260807195009_backfill_tenant_data_object_routes_phase2.sql`
- `20260807195231_make_inet_payment_intents_data_plane_aware.sql`
- `20260807195439_restrict_app_privileged_security_definers_phase2.sql`

`tenant_data_object_routes` is service-role-only and maps business object UUIDs to tenant/branch. It does not choose the data home; the current `tenant_data_lifecycle.data_home` remains authoritative.

INET NOPS intent/callback records remain in CpiPOS-001 because provider callbacks arrive without a trusted POS session or tenant route. The former same-database order FK was replaced with a database trigger that validates `order_id + tenant_id + branch_id` against either a Primary order or the server-only cross-plane order registry. This keeps callback lookup stable without pretending PostgreSQL can enforce a foreign key across projects.

## Security Baseline

CpiPOS-002 verified after the latest migrations:

- invalid indexes: 0
- unvalidated constraints: 0
- direct `anon`/`authenticated` table grants: 0
- public SECURITY DEFINER functions executable by anon/authenticated: 0
- business/anchor tables use RLS with no client policies by design

CpiPOS-001 verified:

- `tenant_data_object_routes` direct client grants: 0
- public SECURITY DEFINER functions executable by anon/authenticated: 0
- privileged `app.*` transaction SECURITY DEFINER functions are restricted to `service_role`
- authenticated EXECUTE remains only on reviewed RLS helper functions such as `has_branch_access`, `has_role`, `has_tenant_access`, `is_it_admin`, and `tenant_has_feature`

## Regression / Failure Tests

All disposable database tests were executed in transactions and rolled back.

Passed:

1. DB2 order + recipe stock deduction + payment completion atomic smoke test.
2. Non-delivery price tampering: catalog 100 / submitted 1 -> rejected with `UNTRUSTED_UNIT_PRICE`.
3. Correct non-delivery price -> line total normalized by the database.
4. Delivery server-resolved unit price -> accepted and line total normalized.
5. Stock adjustment 1000 -> 900 -> passed.
6. Retrying the same stock request ID -> duplicate recognized; stock not deducted twice.
7. Stock below zero with negative stock disabled -> rejected.
8. DB2 order creation without a current CpiPOS-001 runtime lease -> rejected (`TRIAL_RUNTIME_LEASE_INVALID`).
9. INET intent referencing a registered Trial order -> accepted in CpiPOS-001.
10. INET intent referencing an unregistered/mismatched order UUID -> rejected (`PAYMENT_INTENT_ORDER_ROUTE_MISMATCH`).

## BBQ / TEST Dry-Run Copy

Current pre-launch Trial tenants were copied to CpiPOS-002 without changing routing:

- `BBQ-TH-002` / store code `800001`: 1 branch; no business transaction/catalog rows at snapshot time.
- `TEST-TH-003` / store code `800002`: products 2, ingredients 2, recipes 2, dining tables 2, orders 2, order items 3, payments 0, bill sessions 2, QR sessions 2, QR orders 1; order total 1020; payment total 0; inventory total 0.

Verification:

- business UUIDs preserved;
- row counts match;
- order/payment/inventory totals match;
- canonical checksums with normalized numeric scale match.

Current authoritative state remains:

```text
data_home=primary
desired_data_home=trial
migration_status=verifying
source_home=primary
target_home=trial
cutover_allowed=false
```

No production traffic is routed to CpiPOS-002 yet.

## CI / Drift Protection

CI separately validates:

- CpiPOS-001 migration baseline with `schema:drift`;
- CpiPOS-002 migration baseline with `schema:drift:trial`;
- Web typecheck/lint/tests/build;
- Mobile typecheck/lint/tests/build.

Trial migrations must stay under `supabase/trial-data-plane/migrations/`; they must not be copied into the Primary migration directory.

## Remaining External Cutover Gate

The code/database architecture is ready for a Trial canary, but production cannot safely switch `data_home=trial` until Vercel has the CpiPOS-002 server credential. Do not use the publishable key as a replacement.

Set directly in Vercel server environment:

```env
TRIAL_SUPABASE_URL=https://kawenyvpentwgugtzqec.supabase.co
TRIAL_SUPABASE_SERVICE_ROLE_KEY=<CpiPOS-002 server secret>
TRIAL_DATA_ROUTING_ENABLED=true
```

Never expose `TRIAL_SUPABASE_SERVICE_ROLE_KEY` through `NEXT_PUBLIC_*`, GitHub, browser code, logs, or chat transcripts.

Final cutover sequence after those variables are confirmed:

1. keep both Trial tenants `data_home=primary`;
2. make a final delta copy/reconciliation Primary -> Trial;
3. refresh object-route registry;
4. canary `TEST-TH-003` first by setting its `data_home=trial`;
5. verify login/session, products, stock, order, payment, receipt/print, Table QR, INET path where configured, retry/idempotency and fail-closed behavior;
6. if clean, mark TEST migration complete;
7. repeat for `BBQ-TH-002`;
8. keep `NDL-TH-001` Primary;
9. retain an explicit cutback procedure to return `data_home=primary` only after reconciling any Trial writes.

Do not claim cutover complete before the production secret and canary have been verified.