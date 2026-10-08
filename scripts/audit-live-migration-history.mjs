/**
 * Compare repository SQL migration versions with an exported Supabase migration
 * history. Read-only, offline, no credentials or live database writes.
 *
 * Usage:
 *   node scripts/audit-live-migration-history.mjs --history ./private-primary-migrations.json
 *   node scripts/audit-live-migration-history.mjs --history ./private-trial-migrations.json --plane trial
 *
 * Input: a JSON array of {version,name?}, a string version array, or
 * {migrations: [...]}. Do not commit production exports to Git.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATION_DIRS = Object.freeze({
  primary: "supabase/migrations",
  trial: "supabase/trial-data-plane/migrations"
});

export function extractMigrationVersion(fileName) {
  const match = /^(\d{12,17})_[^/]+\.sql$/.exec(String(fileName));
  return match?.[1] ?? null;
}

export function analyzeMigrationVersions(sourceFiles, liveEntries) {
  if (!Array.isArray(sourceFiles) || !Array.isArray(liveEntries) || liveEntries.length === 0) {
    throw new Error("migration_history_required: supply a non-empty JSON export");
  }
  const source = new Map();
  const invalidSourceFiles = [];
  const duplicateSourceVersions = [];
  for (const name of sourceFiles) {
    if (!String(name).endsWith(".sql")) continue;
    const version = extractMigrationVersion(path.basename(String(name)));
    if (!version) {
      invalidSourceFiles.push(String(name));
    } else if (source.has(version)) {
      duplicateSourceVersions.push(version);
    } else {
      source.set(version, String(name));
    }
  }
  const live = new Map();
  const invalidLiveVersions = [];
  const duplicateLiveVersions = [];
  for (const item of liveEntries) {
    const version = String(typeof item === "string" ? item : item?.version ?? "").trim();
    if (!/^\d{12,17}$/.test(version)) {
      invalidLiveVersions.push(version);
    } else if (live.has(version)) {
      duplicateLiveVersions.push(version);
    } else {
      live.set(version, typeof item === "string" ? { version } : item);
    }
  }
  const repositoryOnly = [...source].filter(([version]) => !live.has(version))
    .map(([version, file]) => ({ version, file })).sort((a, b) => a.version.localeCompare(b.version));
  const databaseOnly = [...live].filter(([version]) => !source.has(version))
    .map(([version, item]) => ({ version, name: item?.name ?? null }))
    .sort((a, b) => a.version.localeCompare(b.version));
  const matched = [...source.keys()].filter((version) => live.has(version)).length;
  return {
    repositoryTotal: source.size,
    databaseTotal: live.size,
    matched,
    repositoryOnly,
    databaseOnly,
    invalidSourceFiles,
    duplicateSourceVersions,
    invalidLiveVersions,
    duplicateLiveVersions,
    reconciled: matched === source.size && matched === live.size
      && invalidSourceFiles.length === 0 && duplicateSourceVersions.length === 0
      && invalidLiveVersions.length === 0 && duplicateLiveVersions.length === 0
  };
}

export function parseMigrationHistory(jsonText) {
  const input = JSON.parse(jsonText);
  const rows = Array.isArray(input) ? input
    : Array.isArray(input?.migrations) ? input.migrations
    : Array.isArray(input?.result?.migrations) ? input.result.migrations
    : null;
  if (!rows) throw new Error("invalid_migration_history: expected JSON array or {migrations: [...]}");
  return rows;
}

export async function auditMigrationHistory({ plane, historyPath, cwd = process.cwd() }) {
  if (!Object.hasOwn(MIGRATION_DIRS, plane)) throw new Error("invalid_plane: use primary or trial");
  if (!historyPath) throw new Error("missing_history: pass --history path/to/export.json");
  const dir = path.resolve(cwd, MIGRATION_DIRS[plane]);
  const [sourceFiles, historyText] = await Promise.all([
    fs.readdir(dir), fs.readFile(path.resolve(cwd, historyPath), "utf8")
  ]);
  return analyzeMigrationVersions(sourceFiles, parseMigrationHistory(historyText));
}

function parseArgs(argv) {
  const args = { plane: "primary", historyPath: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--plane" && argv[i + 1]) args.plane = argv[++i];
    else if (argv[i] === "--history" && argv[i + 1]) args.historyPath = argv[++i];
    else throw new Error(`unexpected_argument: ${argv[i]}`);
  }
  return args;
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await auditMigrationHistory(args);
    // The report includes migration versions and filenames only. Never print DB secrets or customer data.
    console.log(JSON.stringify({ plane: args.plane, ...result }, null, 2));
    if (!result.reconciled) {
      console.error("BLOCKED: migration history is not reconciled. DO NOT auto-apply or repair migrations.");
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
