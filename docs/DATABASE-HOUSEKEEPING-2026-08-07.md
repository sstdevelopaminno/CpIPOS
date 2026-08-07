# CpIPOS Database Housekeeping Baseline — 2026-08-07

## Scope

This checkpoint records Production database cleanup, organization, security hardening, and low-risk performance work completed before real customer data becomes the normal operating baseline.

The changes were deliberately limited to compatibility-safe operations. No tenant data was rewritten, no live table/column was renamed, and no POS payment, shift, QR, device, login, stock, or order business rule was intentionally changed.

## Production Tenant Baseline

Only these business tenants are part of the current Production baseline:

- `NDL-TH-001`
- `BBQ-TH-002`
- `TEST-TH-003`

`SOLO-TH-001` was removed from Production. The system package code `solo` / `Solo Register` remains valid and must not be confused with the removed tenant.

The default `supabase/seed.sql` is tenant-neutral so `supabase db reset` cannot silently recreate historical demo tenants, users, devices, PINs, orders, products, or stock fixtures.

## Structural Audit Result

At the initial housekeeping checkpoint:

- invalid/not-ready indexes: 0
- duplicate constraint definitions: 0
- unvalidated public/app constraints: 0
- active long-running transaction/lock blockers during audit: 0
- public foreign keys: 266
- public primary keys: 80
- public unique constraints: 46
- public check constraints: 91

The database is intentionally not being renamed or repartitioned while Production clients depend on current object names.

## Phase 1 — Safe Scope Indexes

Applied to Production and mirrored to the repository:

`20260807152000_add_safe_scope_lookup_indexes.sql`

Indexes:

```sql
idx_recipes_tenant_branch_product
idx_stock_movements_scope_reference
idx_user_branch_roles_tenant_branch_user
```

These indexes were selected from actual `pg_stat_statements` workload and `EXPLAIN ANALYZE`, not from blanket foreign-key indexing. Existing hot paths that were already fast and indexed were left unchanged.

## Phase 2 — RLS Evaluation Optimization

Applied migration:

`20260807154613_optimize_rls_auth_initplan_phase2.sql`

The migration preserves policy intent while replacing direct per-row `auth.uid()` evaluation with `(select auth.uid())` where appropriate. It covers user profile, manager approval, mobile device session, approval permission, attendance, and leave policies.

After application, the Supabase `auth_rls_initplan` performance warnings targeted by this migration were no longer reported.

## Phase 2 — Privileged RPC Hardening

Applied migration:

`20260807155636_restrict_service_only_security_definer_rpcs.sql`

Privileged `SECURITY DEFINER` functions exposed through `public` were verified against current Web/Mobile server call sites. Service-only RPCs now deny direct `anon` and `authenticated` execution while preserving `service_role` execution.

This includes the main POS order/payment wrappers, stock adjustment, mobile takeaway checkout/hold, runtime cleanup, order-number allocation, recipe deduction, staff-cancel configuration, and the RLS event-trigger helper.

Verification after migration showed all current `public` `SECURITY DEFINER` functions with:

- `anon EXECUTE = false`
- `authenticated EXECUTE = false`
- `service_role EXECUTE = true`

The Supabase Security Advisor no longer reported exposed `SECURITY DEFINER` function findings after this hardening.

## Phase 2 — Function Search Path Hardening

Applied migration:

`20260807155747_lock_app_function_search_paths.sql`

Nine `app` functions reported with mutable search paths were pinned to:

```text
pg_catalog, public, app, extensions
```

Function bodies and trigger behavior were not changed. This prevents object-shadowing through a mutable caller search path while preserving current object resolution.

After application, the corresponding `function_search_path_mutable` Security Advisor findings were no longer reported.

## Phase 2 — Hot Relationship Indexes

Applied migration:

`20260807155904_add_hot_relationship_indexes_phase2.sql`

Added only three relationship indexes backed by actual workflow/query evidence:

```sql
idx_orders_shift_open_dine_in
idx_table_qr_orders_order_id
idx_table_bill_sessions_order_id
```

Reasons:

- shift-close rules query `orders` by `shift_id` directly;
- Table QR history/diagnostics joins `table_qr_orders` through `order_id`;
- table bill history joins `table_bill_sessions` through `order_id`.

A blanket index for every foreign key was intentionally avoided to limit write amplification. Planner statistics were refreshed with `ANALYZE` on the affected hot tables after the migrations.

## Security Advisor State After Phase 2

The remaining database-side Security Advisor notices are primarily `RLS Enabled No Policy` INFO entries for tables intentionally accessed through trusted server/service-role paths. RLS with no policy is deny-by-default for ordinary API roles; policies must not be added merely to silence the Advisor.

One project-level Auth setting remains outside SQL migration control:

- Supabase Auth `Leaked Password Protection` is currently disabled and should be enabled in Auth Settings before customer onboarding.

## Naming Standard Going Forward

Use `snake_case` for database objects and columns.

Recommended conventions for new objects:

- normal index: `idx_<table>_<purpose>`
- unique index: `uq_<table>_<scope>`
- foreign key constraint: `fk_<table>_<column>`
- check constraint: `chk_<table>_<rule>`
- trigger: `trg_<table>_<purpose>`
- functions: verb-oriented `snake_case`

Do not rename an existing live object solely to satisfy this convention. Existing names are compatibility contracts until a separately tested migration proves that every API, RPC, RLS policy, trigger, client, and operational script has been migrated safely.

## Relationship Standard

Business data should preserve the hierarchy:

`tenant -> branch -> device/user/session/transaction`

For tenant-scoped tables:

- never trust client-provided tenant or branch scope;
- keep tenant/branch scope derivation server-side;
- foreign keys must point to canonical parent records;
- queries that use tenant+branch scope frequently should prefer leading composite indexes only when workload justifies them;
- do not create every possible single-column foreign-key index automatically because extra indexes increase write amplification.

## Constraint Standard

- Primary keys remain UUID-based unless a domain has a stronger reason otherwise.
- Unique constraints must represent actual business uniqueness, not convenience assumptions.
- `CHECK` constraints must reflect configurable business rules. Do not reintroduce a global non-negative stock check because negative-stock permission is branch-aware.
- `ON DELETE CASCADE`, `SET NULL`, and `RESTRICT` must be chosen according to lifecycle semantics; do not normalize delete actions merely for style.

## Deferred / Observation-Window Work

Do not change these merely to make Advisor counts reach zero:

- overlapping permissive RLS policies: combine only after proving equivalent access for every role/action;
- RLS-enabled server-only tables with no policy: keep deny-by-default unless a real direct-client use case is introduced;
- unused-index candidates: require a longer production observation window before removal;
- remaining foreign-key index suggestions: add only when workload, parent-delete behavior, or measurable query plans justify them;
- live table/column/constraint renaming or schema moves out of `public`.

## Reset / Seed Rule

The default reset path is infrastructure/schema setup, not a Production-data bootstrap.

Do not place these in `supabase/seed.sql`:

- production tenant/store codes;
- demo tenant bundles;
- branch/device identifiers;
- Auth users or passwords;
- POS employee codes or PINs;
- orders/payments;
- products/ingredients/stock fixtures.

When temporary fixtures are necessary, use an explicit local-only/opt-in fixture script and never reuse Production identifiers or credentials.
