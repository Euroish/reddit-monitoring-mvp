import assert from "node:assert/strict";
import test from "node:test";
import { copyFile, mkdtemp, readFile, readdir, writeFile, rm } from "node:fs/promises";
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
  // Verify core post-050..058 tables exist and retired legacy tables never return.
  // Table count is intentionally uncapped; schema safety is enforced via immutable migrations + Squawk + CODEOWNERS.
  assert.ok(tables.includes("app_auth_challenge"));
  assert.ok(tables.includes("app_auth_mfa"));
  assert.ok(tables.includes("app_auth_mfa_login"));
  assert.ok(tables.includes("source_provider_credential"));
  assert.ok(tables.includes("plan_collection_policy"));
  assert.ok(tables.includes("user_provider_usage"));
  assert.ok(tables.includes("doc_page"));
  for (const aiTable of [
    "ai_vendor",
    "ai_vendor_source",
    "ai_model",
    "ai_model_alias",
    "ai_registry_source",
    "ai_registry_listing",
    "ai_registry_change",
    "ai_model_spec_observation",
    "ai_event_candidate",
    "ai_release_event",
    "ai_event_reference",
    "ai_sync_run",
    "ai_benchmark_snapshot",
    "ai_benchmark_entry",
    "ai_llm_extraction_cache",
    "ai_auto_publish_audit",
    "ai_ops_alert",
  ]) {
    assert.ok(tables.includes(aiTable), `${aiTable} should exist after 054/055`);
  }
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


test("PG16 upgrades applied 058 to the immutable batch migrations and safely reruns them", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "monitor-pr30-058-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const schema = join(process.cwd(), "src/storage/schema");
  const baseline = (await readdir(schema)).filter(file => /^\d{3}_.+\.sql$/.test(file) && Number(file.slice(0, 3)) <= 58);
  await Promise.all(baseline.map(file => copyFile(join(schema, file), join(directory, file))));
  const db = await testDatabase(directory);
  t.after(db.close);
  const before = await db.pool.query("SELECT filename,checksum FROM schema_migration ORDER BY filename");
  assert.match(before.rows.at(-1).filename, /^058_/);
  assert.equal((await db.pool.query("SELECT to_regclass('collection_batch') AS table_name")).rows[0].table_name, null);
  assert.deepEqual(await runMigrations({ pool: db.pool }), [
    "059_project_batches_and_ownership.sql", "060_batch_visibility_and_field_policy.sql",
    "061_content_enrichment_and_source_lanes.sql", "062_feed_personalization_and_seen.sql",
    "063_social_intelligence_monitors_and_rollups.sql", "064_feed_positive_event_idempotency.sql",
    "065_monitor_managed_sources.sql", "066_p0_p1_remediation.sql", "067_collection_limits_and_tiers.sql",
  ]);
  assert.deepEqual(await runMigrations({ pool: db.pool }), []);
  const after = await db.pool.query("SELECT filename,checksum FROM schema_migration ORDER BY filename");
  assert.deepEqual(after.rows.slice(0, before.rows.length), before.rows);
  assert.equal((await db.pool.query("SELECT to_regclass('idx_monitor_project_batch_project_status') IS NOT NULL AS exists")).rows[0].exists, true);
});

test("PG16 upgrades main 060 to V2 without changing historical checksums or batch/project state", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "monitor-v2-main060-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const schema = join(process.cwd(), "src/storage/schema");
  const baseline = (await readdir(schema)).filter(file => /^\d{3}_.+\.sql$/.test(file) && Number(file.slice(0, 3)) <= 60);
  await Promise.all(baseline.map(file => copyFile(join(schema, file), join(directory, file))));
  const db = await testDatabase(directory);
  t.after(db.close);
  const before = (await db.pool.query("SELECT filename,checksum FROM schema_migration ORDER BY filename")).rows;
  assert.match(before.at(-1).filename, /^060_/);
  const sourceId = randomUUID(), batchId = randomUUID(), projectId = randomUUID();
  const mediaId = randomUUID(), officialId = randomUUID();
  await db.pool.query(
    `INSERT INTO collection_source(id,platform_id,primary_provider,label,target,content_kind,delivery_mode,created_at,updated_at)
     SELECT $1,id,'external_ingest','Existing research','{"type":"search","query":"retained"}','post','push',now(),now()
     FROM source WHERE code='reddit'`, [sourceId],
  );
  await db.pool.query("INSERT INTO collection_batch(id,collection_source_id,label,visibility) VALUES($1,$2,'Existing batch','shared')", [batchId, sourceId]);
  await db.pool.query("INSERT INTO monitor_project(id,name,dataset_mode) VALUES($1,'Existing project','batch')", [projectId]);
  await db.pool.query("INSERT INTO monitor_project_batch(project_id,batch_id) VALUES($1,$2)", [projectId, batchId]);
  await db.pool.query(
    `INSERT INTO collection_source(id,platform_id,primary_provider,label,target,content_kind,delivery_mode,
       source_group,schedule,next_due_at,created_at,updated_at)
     SELECT fixture.id, s.id, 'feed', fixture.label, jsonb_build_object('type','rss','url',fixture.url),
       'article','pull',fixture.source_group,'{"enabled":true,"cadenceSeconds":3600}',now(),now(),now()
     FROM source s CROSS JOIN (VALUES
       ($1::uuid,'Media fixture','https://example.com/legacy-media.xml','tech-media'),
       ($2::uuid,'V2EX-named official fixture','https://example.com/official.xml','ai-firsthand')
     ) AS fixture(id,label,url,source_group) WHERE s.code='web'`, [mediaId, officialId],
  );
  await db.pool.query("INSERT INTO ai_vendor_source(vendor_id,source_id) SELECT id,$1 FROM ai_vendor WHERE slug='openai'", [officialId]);
  await db.pool.query("UPDATE source_provider_budget SET daily_resources=1000,enabled=false WHERE provider='kaix'");
  const snapshot = async () => (await db.pool.query(
    `SELECT b.id AS batch_id, b.collection_source_id, b.label AS batch_label, b.visibility AS batch_visibility,
       p.id AS project_id, p.name AS project_name, p.dataset_mode, p.owner_user_id,
       pb.status AS membership_status
     FROM collection_batch b JOIN monitor_project_batch pb ON pb.batch_id=b.id
     JOIN monitor_project p ON p.id=pb.project_id WHERE b.id=$1`, [batchId],
  )).rows;
  const existing = await snapshot();
  assert.deepEqual(await runMigrations({ pool: db.pool }), [
    "061_content_enrichment_and_source_lanes.sql", "062_feed_personalization_and_seen.sql",
    "063_social_intelligence_monitors_and_rollups.sql", "064_feed_positive_event_idempotency.sql",
    "065_monitor_managed_sources.sql", "066_p0_p1_remediation.sql", "067_collection_limits_and_tiers.sql",
  ]);
  const planLimits = (await db.pool.query("SELECT plan_tier, max_batch_limit FROM plan_collection_policy ORDER BY plan_tier")).rows;
  assert.deepEqual(planLimits, [
    { plan_tier: "free", max_batch_limit: 2000 },
    { plan_tier: "pro", max_batch_limit: 5000 },
  ]);
  assert.deepEqual(await snapshot(), existing);
  assert.equal((await db.pool.query("SELECT visibility FROM monitor_project WHERE id=$1", [projectId])).rows[0].visibility, "shared");
  assert.equal((await db.pool.query("SELECT daily_social_item_ceiling FROM source_global_budget WHERE id='default'")).rows[0].daily_social_item_ceiling, 20000);
  assert.deepEqual((await db.pool.query("SELECT filename,checksum FROM schema_migration ORDER BY filename")).rows.slice(0, before.length), before);
  assert.equal((await db.pool.query("SELECT feed_lane,usage_domain FROM collection_source WHERE id=$1", [sourceId])).rows[0].usage_domain, "research");
  assert.equal((await db.pool.query("SELECT monitor_managed FROM collection_source WHERE id=$1", [sourceId])).rows[0].monitor_managed, false);
  const readSource = async (id: string) => (await db.pool.query(
    `SELECT state,feed_lane,schedule->'enabled' AS scheduled,next_due_at IS NOT NULL AS due
     FROM collection_source WHERE id=$1`, [id],
  )).rows[0];
  assert.deepEqual(await readSource(mediaId), { state: "archived", feed_lane: "news", scheduled: false, due: false });
  assert.deepEqual(await readSource(officialId), { state: "active", feed_lane: "release", scheduled: true, due: true });
  assert.deepEqual((await db.pool.query("SELECT enabled,daily_resources FROM source_provider_budget WHERE provider='kaix'")).rows,
    [{ enabled: false, daily_resources: 10000 }]);
  assert.deepEqual(await runMigrations({ pool: db.pool }), []);
});
