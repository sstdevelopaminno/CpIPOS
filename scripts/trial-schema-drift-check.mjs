import fs from "node:fs/promises";
import path from "node:path";

const primaryDir = path.resolve("supabase/migrations");
const trialDir = path.resolve("supabase/trial-data-plane/migrations");

const requiredMigrations = [
  "20260807190055_trial_data_plane_foundation_v1.sql",
  "20260807190418_trial_data_plane_transactions_v1.sql"
];

const requiredMarkers = [
  "create table public.trial_tenant_scopes",
  "create table public.trial_branch_scopes",
  "create table public.trial_runtime_leases",
  "create table public.orders",
  "create table public.payments",
  "create table public.stock_movements",
  "create table public.table_qr_orders",
  "create or replace function app.require_trial_runtime",
  "create or replace function app.create_pos_order_tx",
  "create or replace function app.complete_pos_payment_tx",
  "create or replace function app.submit_table_qr_order_tx",
  "revoke all on all tables in schema public from anon, authenticated",
  "grant all on all tables in schema public to service_role",
  "alter table public.orders enable row level security",
  "alter table public.payments enable row level security"
];

const forbiddenPrimaryMarkers = [
  "create table public.trial_tenant_scopes",
  "create table public.trial_branch_scopes",
  "create table public.trial_runtime_leases"
];

function normalizeSql(value) {
  return value.toLowerCase().replace(/\s+/g, " ");
}

async function readSqlBundle(dir) {
  const files = (await fs.readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
  const chunks = await Promise.all(files.map((file) => fs.readFile(path.join(dir, file), "utf8")));
  return { files, bundle: normalizeSql(chunks.join("\n")) };
}

async function main() {
  const [primary, trial] = await Promise.all([readSqlBundle(primaryDir), readSqlBundle(trialDir)]);

  const failures = [];
  for (const file of requiredMigrations) {
    if (!trial.files.includes(file)) failures.push(`missing CpiPOS-002 migration: ${file}`);
    if (primary.files.includes(file)) failures.push(`CpiPOS-002 migration leaked into Primary path: ${file}`);
  }
  for (const marker of requiredMarkers) {
    if (!trial.bundle.includes(marker.toLowerCase())) failures.push(`missing CpiPOS-002 SQL marker: ${marker}`);
  }
  for (const marker of forbiddenPrimaryMarkers) {
    if (primary.bundle.includes(marker.toLowerCase())) failures.push(`Trial Data Plane schema leaked into Primary migrations: ${marker}`);
  }

  if (failures.length) {
    console.error("CpiPOS-002 schema drift check failed.");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log("CpiPOS-002 schema drift check passed.");
  console.log(`- trial migrations scanned: ${trial.files.length}`);
  console.log(`- required trial migrations: ${requiredMigrations.length}`);
  console.log(`- required SQL markers: ${requiredMarkers.length}`);
  console.log("- Primary/Trial migration paths remain separated");
}

main().catch((error) => {
  console.error("CpiPOS-002 schema drift check crashed.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
