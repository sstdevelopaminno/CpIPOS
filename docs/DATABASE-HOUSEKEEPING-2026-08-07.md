# CpIPOS Database Housekeeping Baseline — 2026-08-07

## Scope

This checkpoint records database cleanup and organization work that was deliberately limited to zero-behavior-change operations. No production business data, API contracts, RLS semantics, session behavior, payment logic, shift logic, triggers, RPC behavior, or tenant/device permissions were changed by the housekeeping migration.

## Production Tenant Baseline

Only these business tenants are part of the current Production baseline:

- `NDL-TH-001`
- `BBQ-TH-002`
- `TEST-TH-003`

`SOLO-TH-001` was removed from Production. The system package code `solo` / `Solo Register` remains valid and must not be confused with the removed tenant.

The default `supabase/seed.sql` is tenant-neutral so `supabase db reset` cannot silently recreate historical demo tenants, users, devices, PINs, orders, products, or stock fixtures.

## Structural Audit Result

At the time of this checkpoint:

- invalid/not-ready indexes: 0
- duplicate constraint definitions: 0
- unvalidated public/app constraints: 0
- active long-running transaction/lock blockers during audit: 0
- public foreign keys: 266
- public primary keys: 80
- public unique constraints: 46
- public check constraints: 91

The database is intentionally not being renamed or repartitioned while Production clients depend on current object names.

## Safe Index Migration

Applied to Production and mirrored to the repository:

`20260807152000_add_safe_scope_lookup_indexes.sql`

Indexes:

```sql
create index if not exists idx_recipes_tenant_branch_product
  on public.recipes (tenant_id, branch_id, product_id);

create index if not exists idx_stock_movements_scope_reference
  on public.stock_movements (tenant_id, branch_id, movement_type, ref_table, ref_id);

create index if not exists idx_user_branch_roles_tenant_branch_user
  on public.user_branch_roles (tenant_id, branch_id, user_id);
```

These indexes were selected from actual `pg_stat_statements` workload and `EXPLAIN ANALYZE`, not from blanket foreign-key indexing. Existing hot paths that were already fast and indexed were left unchanged.

After application all three indexes were `indisvalid=true`, `indisready=true`, and `indislive=true`. Production still had exactly three approved tenants and no invalid indexes.

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

## Deferred Work — Requires Separate Controlled Change

The following were audited but intentionally not modified because they can alter runtime/security behavior:

- RLS policies that evaluate auth helpers per row or have overlapping permissive policies;
- RLS-enabled tables with no direct client policy because some are intentionally server/service-role accessed;
- public `SECURITY DEFINER` RPC execution grants;
- functions with mutable `search_path`;
- unused-index candidates, which require a longer observation window before removal;
- further POS-session index reduction, which could improve write cost but requires concurrency/load evidence first;
- live table/column/constraint renaming or schema moves out of `public`.

Any work in those categories must be treated as a separate migration with targeted integration tests and rollback evidence.

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
