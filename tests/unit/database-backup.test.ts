import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";

test("backup/restore guards restrict output and refuse remote or original target databases", async () => {
  const { backupFile, databaseEnvironment, restoreDatabaseName } = await import("../../scripts/database-backup-lib.mjs");
  const root = process.cwd();
  assert.equal(backupFile(root, "output/backups/fixture.dump"), path.join(root, "output/backups/fixture.dump"));
  for (const file of ["../fixture.dump", "output/../fixture.dump", ".env.local", "output/backups/fixture.json"])
    assert.throws(() => backupFile(root, file), /output.*dump/);
  for (const url of ["postgresql://u:p@remote.test/db", "https://localhost/db", "postgresql://localhost/db?host=remote.test"])
    assert.throws(() => databaseEnvironment(url), /loopback/);
  const env = databaseEnvironment("postgresql://fixture:secret@127.0.0.1:25432/source_validation_backup", {});
  assert.equal(env.PGPASSWORD, "secret"); assert.equal(env.PGHOST, "127.0.0.1"); assert.equal(env.PGPORT, "25432");
  assert.equal(restoreDatabaseName("source_validation_restore_123"), "source_validation_restore_123");
  assert.equal(restoreDatabaseName("info_workbench_restore_123"), "info_workbench_restore_123");
  for (const value of ["info_workbench_dev", "postgres", "source_validation_a;DROP", "../other", "source_validation_"])
    assert.throws(() => restoreDatabaseName(value), /fresh.*restore/);
});

test("database inventory comparison rejects count or migration drift", async () => {
  const { compareInventory } = await import("../../scripts/database-backup-lib.mjs");
  const expected = { tables: { app_user: 2, content: 25 }, migrations: [{ filename: "001.sql", checksum: "abc" }] };
  assert.equal(compareInventory(expected, structuredClone(expected)), true);
  for (const actual of [
    { ...expected, tables: { app_user: 1, content: 25 } },
    { ...expected, tables: { ...expected.tables, unexpected_table: 1 } },
    { ...expected, migrations: [{ filename: "001.sql", checksum: "different" }] },
  ]) assert.throws(() => compareInventory(expected, actual), /inventory/);
});
