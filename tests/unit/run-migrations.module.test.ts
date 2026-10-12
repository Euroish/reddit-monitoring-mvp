import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMigrations } from "../../src/storage/schema/run-migrations";

test("run-migrations module import is side-effect free", async () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  try {
    await assert.doesNotReject(async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require("../../src/storage/schema/run-migrations");
    });
  } finally {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  }
});

test("runMigrations locks a pinned transaction and records DDL atomically", async () => {
  const schemaDir = await mkdtemp(join(tmpdir(), "run-migrations-"));
  const sql = ["BEGIN;", "CREATE TABLE demo (id INTEGER);", "COMMIT;"].join("\n");

  class FakeDb {
    public readonly calls: Array<{ text: string; params?: unknown[] }> = [];

    public async query(text: string, params?: unknown[]) {
      this.calls.push({ text, params });

      if (text.includes("SELECT filename, checksum FROM schema_migration")) {
        return { rows: [] };
      }

      return { rows: [] };
    }

    public async close(): Promise<void> {}
    public async withTransaction<T>(fn: (client: FakeDb) => Promise<T>): Promise<T> { return fn(this); }
  }

  const db = new FakeDb();

  try {
    await writeFile(join(schemaDir, "001_demo.sql"), `${sql}\n`, "utf8");

    const applied = await runMigrations({
      schemaDir,
      db: db as never,
    });

    assert.deepEqual(applied, ["001_demo.sql"]);
    assert.equal(db.calls.length, 5);
    assert.match(db.calls[0].text, /pg_advisory_xact_lock/);
    assert.match(db.calls[1].text, /CREATE TABLE IF NOT EXISTS schema_migration/);
    assert.match(db.calls[2].text, /SELECT filename, checksum FROM schema_migration/);
    assert.match(db.calls[3].text, /CREATE TABLE demo/);
    assert.doesNotMatch(db.calls[3].text, /BEGIN;|COMMIT;/);
    assert.match(db.calls[4].text, /INSERT INTO schema_migration/);
    assert.deepEqual(db.calls[4].params?.[0], "001_demo.sql");
  } finally {
    await rm(schemaDir, { recursive: true, force: true });
  }
});
