# CpiPOS Trial Data Plane Status

Date: 2026-08-08

## Database Roles

- `CpiPOS-001` (`deejlitaivfnsbwqdugy`) is Primary and remains the identity/control-plane authority.
- `CpiPOS-002` (`kawenyvpentwgugtzqec`) is the Trial Data Plane.
- `CpiPOS-002` is not a backup database and clients must never select it directly.
- Supabase Auth/JWT, tenant lifecycle, access codes, user/branch roles, device/login policy and IT Admin authority remain in `CpiPOS-001`.

## CpiPOS-002 Applied Migrations

Source path: `supabase/trial-data-plane/migrations/`

1. `20260807190055_trial_data_plane_foundation_v1.sql`
   - scope anchors: `trial_tenant_scopes`, `trial_branch_scopes`, `trial_runtime_leases`
   - catalog/inventory: products, ingredients, recipes, stock movements
   - sales: orders, order items, payments
   - dine-in/table QR business tables
   - composite tenant/branch FKs
   - RLS enabled and direct client access denied
2. `20260807190418_trial_data_plane_transactions_v1.sql`
   - runtime lease validation
   - atomic order creation + stock deduction
   - payment completion with request-group advisory locking
   - table QR transaction flow
   - privileged RPCs restricted to `service_role`

## Security Baseline

Verified on CpiPOS-002 after migration:

- `anon` public-table SELECT grants: 0
- `authenticated` public-table SELECT grants: 0
- invalid public indexes: 0
- unvalidated public/app constraints: 0
- SECURITY DEFINER functions executable by anon/authenticated: 0
- public business/anchor tables use RLS with no client policies by design (deny-by-default)

Supabase Security Advisor reports only expected `RLS Enabled No Policy` INFO notices for these server-only tables.

## Transaction Smoke Test

A disposable scope was created and completely removed after verification:

1. tenant/branch scope created
2. runtime lease created
3. product + ingredient + recipe created
4. POS order created through transaction RPC
5. ingredient stock reduced from 1000 to 900 atomically
6. cash payment completed through transaction RPC
7. order became completed with paid total 100
8. disposable tenant scope deleted and all child data removed

Result: PASS; no smoke data remained.

## BBQ / TEST Dry-Run Copy

The current pre-launch test tenants were copied to CpiPOS-002 without changing routing:

- `BBQ-TH-002` / public store code `800001`
  - 1 branch
  - no business transaction/catalog rows
- `TEST-TH-003` / public store code `800002`
  - products 2
  - ingredients 2
  - recipes 2
  - dining tables 2
  - orders 2
  - order items 3
  - payments 0
  - table bill sessions 2
  - table QR sessions 2
  - table QR orders 1
  - order total 1020
  - payment total 0
  - inventory total 0

All copied business UUIDs are preserved.

Reconciliation result:

- row counts: MATCH
- order/payment/inventory totals: MATCH
- full-row checksums: matched where physical numeric representation is identical
- canonical checksums with normalized numeric scale: MATCH for products, ingredients, recipes, dining tables, orders, order items and table QR orders

CpiPOS-001 lifecycle state after dry run:

- `data_home=primary`
- `desired_data_home=trial`
- `migration_status=verifying`
- `source_home=primary`
- `target_home=trial`
- `cutover_allowed=false`

No production traffic is routed to CpiPOS-002 yet.

## Cutover Blockers

Do not set `data_home=trial` or `TRIAL_DATA_ROUTING_ENABLED=true` until all items below are complete:

1. server-only CpiPOS-002 service client configured using `TRIAL_SUPABASE_SERVICE_ROLE_KEY`
2. tenant data router wired into required business services/APIs
3. runtime lease synchronization from authenticated CpiPOS-001 POS sessions/shifts
4. read/write regression tests for Web, Android, Windows and Mobile
5. table QR regression test
6. payment/idempotency retry test
7. outage/fail-closed test
8. explicit final reconciliation immediately before cutover
9. rollback/cutback drill

## Go-Live P0 Findings Outside DB2

Before customer go-live, fix or explicitly prove safe these application paths:

- `apps/backoffice-web/src/lib/services/pos-sales-service.ts`: emergency direct-create/direct-payment/soft-stock-bypass flags currently evaluate to enabled when their environment variables are missing. Source should be changed to explicit opt-in; until then Production must explicitly set all three flags to `false`.
- `apps/backoffice-web/src/app/api/pos/sales/route.ts`: non-delivery pricing currently accepts a non-negative client-supplied `unit_price`. Server-side pricing must use trusted catalog price unless a separately authorized pricing/discount mechanism applies.

These are independent of CpiPOS-002 and must not be hidden by the Trial Data Plane rollout.
