import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { testDatabase } from "../helpers/database";
import { runMigrations } from "../../src/storage/schema/run-migrations";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { exportLegacyAssets } from "../../scripts/export-legacy-assets";

test("PG16 forward migration failure rolls back DDL/ledger, 050 drops legacy schema, and asset export works post-050", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  const directory = await mkdtemp(join(tmpdir(), "monitor-migration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    join(directory, "099_failure_fixture.sql"),
    "BEGIN; ALTER TABLE app_user ADD COLUMN failure_fixture TEXT; SELECT 1/0; COMMIT;\n",
  );
  await assert.rejects(
    runMigrations({ pool: db.pool, schemaDir: directory }),
    /division by zero/,
  );
  assert.equal(
    (
      await db.pool.query(
        "SELECT 1 FROM information_schema.columns WHERE table_name='app_user' AND column_name='failure_fixture'",
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (
      await db.pool.query(
        "SELECT 1 FROM schema_migration WHERE filename='099_failure_fixture.sql'",
      )
    ).rowCount,
    0,
  );
  // Verify 050 removed retired tables and dead columns cleanly.
  const tables = (
    await db.pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")
  ).rows.map((r) => r.tablename);
  // 053 新增文档中心 doc_page，公网表预算上限仍为 24
  assert.equal(tables.length, 24);
  assert.ok(tables.length <= 24, "public table budget is 24");
  assert.ok(tables.includes("source_provider_credential"));
  assert.ok(tables.includes("plan_collection_policy"));
  assert.ok(tables.includes("user_provider_usage"));
  assert.ok(tables.includes("doc_page"));
  for (const dropped of ["research_export", "research_export_member", "saved_workbench_view", "collection_job", "monitor_target"]) {
    assert.equal(tables.includes(dropped), false, `${dropped} should be dropped`);
  }
  const deadCols = await db.pool.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema='public' AND (
      (table_name='public_content_search_document' AND column_name IN ('normalized_title','normalized_text'))
      OR (table_name='collection_source' AND column_name IN ('provider','refresh','next_recheck_at'))
      OR (table_name='content' AND column_name IN ('target_id','account_id','total_eligible'))
    )`);
  assert.equal(deadCols.rowCount, 0);

  await bootstrapOwner(db.pool, "fixture-password-123", "owner@example.test");
  const user = (await db.pool.query("SELECT id FROM app_user")).rows[0].id;
  await db.pool.query(
    "INSERT INTO content_saved_query(id,user_id,name,query,created_at,updated_at) VALUES($1,$2,'Private query','{\"query\":\"ai\"}',NOW(),NOW())",
    [randomUUID(), user],
  );
  const destination = join(directory, "assets");
  const manifest = await exportLegacyAssets(db.url, destination);
  const entry = manifest.files.find(
    (file) => file.file === `${user}-content_saved_query.json`,
  )!;
  assert.equal(entry.rows, 1);
  assert.equal(entry.ownerId, user);
  const bytes = await readFile(join(destination, entry.file));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
  assert.equal(JSON.parse(bytes.toString())[0].name, "Private query");
  assert.equal(manifest.databaseChanged, false);
  await assert.rejects(exportLegacyAssets(db.url, destination), /EEXIST/);
});
