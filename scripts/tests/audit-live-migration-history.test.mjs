import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  analyzeMigrationVersions, extractMigrationVersion, parseMigrationHistory
} from "../audit-live-migration-history.mjs";

describe("read-only Supabase migration reconciliation", () => {
  it("recognizes 12-digit legacy and 14-digit versioned SQL filenames", () => {
    assert.equal(extractMigrationVersion("202605170001_init_core.sql"), "202605170001");
    assert.equal(extractMigrationVersion("20261007165444_broadcast.sql"), "20261007165444");
    assert.equal(extractMigrationVersion("not-a-migration.sql"), null);
  });

  it("compares exact full versions rather than chopping every filename to 14 characters", () => {
    const report = analyzeMigrationVersions(
      ["202605170001_init.sql", "20261007165444_latest.sql"],
      [{version:"202605170001",name:"init"}, {version:"20261007165444",name:"latest"}]
    );
    assert.equal(report.matched, 2);
    assert.equal(report.reconciled, true);
    assert.equal(report.repositoryOnly.length, 0);
    assert.equal(report.databaseOnly.length, 0);
  });

  it("reports both database-only and repository-only versions without modifying anything", () => {
    const report = analyzeMigrationVersions(
      ["202605170001_init.sql", "20261007165444_source_only.sql"],
      [{version:"202605170001"}, {version:"20261007153344",name:"db_only"}]
    );
    assert.equal(report.reconciled, false);
    assert.deepEqual(report.repositoryOnly.map(x=>x.version), ["20261007165444"]);
    assert.deepEqual(report.databaseOnly.map(x=>x.version), ["20261007153344"]);
  });

  it("detects collisions, malformed filenames and invalid history entries", () => {
    const report = analyzeMigrationVersions(
      ["202605170001_a.sql", "202605170001_b.sql", "garbled.sql"],
      [{version:"202605170001"}, {version:"202605170001"}, {version:"not-a-version"}]
    );
    assert.equal(report.reconciled, false);
    assert.deepEqual(report.duplicateSourceVersions, ["202605170001"]);
    assert.deepEqual(report.duplicateLiveVersions, ["202605170001"]);
    assert.deepEqual(report.invalidSourceFiles, ["garbled.sql"]);
    assert.deepEqual(report.invalidLiveVersions, ["not-a-version"]);
  });

  it("accepts exports from the Supabase migration list shape", () => {
    assert.equal(parseMigrationHistory('{"migrations":[{"version":"202605170001"}]}').length, 1);
    assert.equal(parseMigrationHistory('{"result":{"migrations":[{"version":"202605170001"}]}}').length, 1);
    assert.throws(() => parseMigrationHistory('{"tables":[]}'), /invalid_migration_history/);
    assert.throws(() => analyzeMigrationVersions([], []), /migration_history_required/);
  });
});
