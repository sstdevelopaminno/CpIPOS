import fs from "node:fs/promises";
import path from "node:path";

const migrationDir = path.resolve("supabase/migrations");
const seedPath = path.resolve("supabase/seed.sql");

const requiredMigrations = [
  "202605170001_init_core.sql",
  "202605170002_rls_policies.sql",
  "202605180001_stock_engine_hardening.sql",
  "202605250005_pos_auth_sessions.sql",
  "202605250007_pos_sales_mvp_scope.sql",
  "202605250009_subscription_feature_gate_enforcement.sql",
  "202606020001_pos_login_performance_indexes.sql",
  "202606020002_shift_open_idempotency.sql",
  "202606030001_pos_user_profile_settings.sql",
  "202606040001_pos_settings_store_payment.sql",
  "202607120001_allow_overdue_shift_auto_close.sql",
  "202607180002_shared_recipe_stock_deduction.sql",
  "202607180007_stock_realtime_publication.sql",
  "20260728173858_print_agent_v1.sql",
  "20260728180311_cash_drawer_v1.sql",
  "20260807152000_add_safe_scope_lookup_indexes.sql",
  "20260807154613_optimize_rls_auth_initplan_phase2.sql",
  "20260807155636_restrict_service_only_security_definer_rpcs.sql",
  "20260807155747_lock_app_function_search_paths.sql",
  "20260807155904_add_hot_relationship_indexes_phase2.sql",
  "20260807164920_restrict_authenticated_helper_policies.sql",
  "20260807181344_tenant_lifecycle_short_store_codes.sql"
];

const requiredSqlMarkers = [
  "create table if not exists pos_sessions",
  "create table if not exists orders",
  "create table if not exists payments",
  "create table if not exists shifts",
  "create table if not exists branch_devices",
  "create table if not exists user_branch_roles",
  "create table if not exists pos_user_profiles",
  "create table if not exists public.print_agents",
  "create table if not exists public.cash_drawer_events",
  "claimed_by_agent_id",
  "create or replace function app.enforce_shift_close_rules",
  "create or replace function app.consume_ingredient",
  "revoke execute on function public.complete_pos_payment_tx",
  "set search_path = pg_catalog, public, app, extensions",
  "idx_orders_shift_open_dine_in",
  "idx_table_qr_orders_order_id",
  "idx_table_bill_sessions_order_id",
  "alter policy %i on %i.%i to authenticated",
  "create table if not exists public.tenant_access_codes",
  "create table if not exists public.tenant_data_lifecycle",
  "create or replace function app.enforce_tenant_access_code_immutable",
  "idx_tenant_data_lifecycle_migration"
];

// The default reset path is intentionally tenant-neutral. Package/feature catalog
// data is migration-managed; tenant/demo fixtures must be explicit opt-in scripts.
const requiredSeedMarkers = [
  "default seed is intentionally tenant-neutral",
  "select 1;"
];

const forbiddenSeedMarkers = [
  "insert into tenants",
  "insert into auth.users",
  "insert into branches",
  "insert into branch_devices",
  "insert into user_branch_roles",
  "insert into products",
  "insert into dine_in_tables",
  "ndl-th-001",
  "bbq-th-002",
  "test-th-003",
  "solo-th-001",
  "caf-th-001",
  "sfd-th-003",
  "bak-th-004",
  "tea-th-005",
  "piz-th-006"
];

function normalizeSql(value) {
  return value.toLowerCase().replace(/\s+/g, " ");
}

async function readMigrationBundle(files) {
  const chunks = await Promise.all(
    files.map(async (file) => {
      const content = await fs.readFile(path.join(migrationDir, file), "utf8");
      return `\n-- ${file}\n${content}`;
    })
  );
  return normalizeSql(chunks.join("\n"));
}

async function main() {
  const entries = await fs.readdir(migrationDir);
  const missingMigrations = requiredMigrations.filter((file) => !entries.includes(file));
  const migrationBundle = await readMigrationBundle(entries.filter((file) => file.endsWith(".sql")).sort());
  const seed = await fs.readFile(seedPath, "utf8");
  const normalizedSeed = normalizeSql(seed);

  const missingSqlMarkers = requiredSqlMarkers.filter((marker) => !migrationBundle.includes(marker));
  const missingSeedMarkers = requiredSeedMarkers.filter((marker) => !normalizedSeed.includes(marker.toLowerCase()));
  const forbiddenSeedHits = forbiddenSeedMarkers.filter((marker) => normalizedSeed.includes(marker.toLowerCase()));
  const failures = [
    ...missingMigrations.map((file) => `missing migration: ${file}`),
    ...missingSqlMarkers.map((marker) => `missing SQL marker: ${marker}`),
    ...missingSeedMarkers.map((marker) => `missing tenant-neutral seed marker: ${marker}`),
    ...forbiddenSeedHits.map((marker) => `forbidden default seed marker: ${marker}`)
  ];

  if (failures.length > 0) {
    console.error("Schema drift preflight failed.");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log("Schema drift preflight passed.");
  console.log(`- migrations scanned: ${entries.filter((file) => file.endsWith(".sql")).length}`);
  console.log(`- required migrations: ${requiredMigrations.length}`);
  console.log(`- required SQL markers: ${requiredSqlMarkers.length}`);
  console.log(`- required tenant-neutral seed markers: ${requiredSeedMarkers.length}`);
  console.log(`- forbidden default seed markers checked: ${forbiddenSeedMarkers.length}`);
}

main().catch((error) => {
  console.error("Schema drift preflight crashed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
