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

test("PG16 forward migration failure rolls back DDL/ledger and legacy assets export by original owner without writes", async (t) => {
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
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@example.test");
  const user = (await db.pool.query("SELECT id FROM app_user")).rows[0].id;
  const exportId = randomUUID();
  await db.pool.query(
    "INSERT INTO research_export(id,user_id,name,total,manifest,payload_bytes,created_at) VALUES($1,$2,'Historic research',1,'{\"formatVersion\":1,\"total\":1}',100,NOW())",
    [exportId, user],
  );
  await db.pool.query(
    "INSERT INTO research_export_member(export_id,ordinal,content_id,identity_key,payload) VALUES($1,1,'historical','reddit:post:historical','{\"text\":\"Private historic evidence\"}')",
    [exportId],
  );
  await db.pool.query(
    "INSERT INTO content_saved_query(id,user_id,name,query,created_at,updated_at) VALUES($1,$2,'Private query','{}',NOW(),NOW())",
    [randomUUID(), user],
  );
  const destination = join(directory, "assets");
  const manifest = await exportLegacyAssets(db.url, destination);
  const entry = manifest.files.find(
    (file) => file.file === `${user}-research_export_member.json`,
  )!;
  assert.equal(entry.rows, 1);
  assert.equal(entry.ownerId, user);
  const bytes = await readFile(join(destination, entry.file));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
  assert.equal(
    JSON.parse(bytes.toString())[0].payload.text,
    "Private historic evidence",
  );
  assert.equal(
    (await db.pool.query("SELECT COUNT(*) FROM research_export_member")).rows[0]
      .count,
    "1",
  );
  assert.equal(manifest.databaseChanged, false);
  await assert.rejects(exportLegacyAssets(db.url, destination), /EEXIST/);
});
