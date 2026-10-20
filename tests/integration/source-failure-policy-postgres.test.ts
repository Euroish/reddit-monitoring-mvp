import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import { runMigrations } from "../../src/storage/schema/run-migrations";
import { PostgresSourceContentRepository } from "../../src/storage/repositories/postgres/postgres-source-content.repository";
import { sourceFailurePolicyCases } from "../helpers/source-failure-policy-cases";

const connectionString = process.env.TEST_SOURCE_DATABASE_URL;
for (const item of sourceFailurePolicyCases) test(`PostgreSQL: ${item.name}`, { skip: !connectionString }, async () => {
  const url = new URL(connectionString!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && /^\/source_validation_[a-z0-9_]+$/.test(url.pathname));
  const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
  const admin = new PostgresClient({ connectionString: adminUrl.href, max: 1 });
  const database = `source_validation_failure_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  try { await admin.query(`CREATE DATABASE "${database}"`); } finally { await admin.close(); }
  url.pathname = `/${database}`;
  const db = new PostgresClient({ connectionString: url.href, max: 5 });
  try {
    await runMigrations({ db });
    assert.deepEqual(await runMigrations({ db }), []);
    await item.run(new PostgresSourceContentRepository(db));
  } finally { await db.close(); }
});

test("PostgreSQL failure-policy upgrade conservatively fences unresolved legacy failures and preserves progress/history", { skip: !connectionString }, async () => {
  const url = new URL(connectionString!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && /^\/source_validation_[a-z0-9_]+$/.test(url.pathname));
  const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
  const admin = new PostgresClient({ connectionString: adminUrl.href, max: 1 });
  const database = `source_validation_failure_upgrade_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  try { await admin.query(`CREATE DATABASE "${database}"`); } finally { await admin.close(); }
  url.pathname = `/${database}`;
  const db = new PostgresClient({ connectionString: url.href, max: 3 });
  const fixtureParent = join(process.cwd(), "output", "validation", "closeout-v0.9.1");
  await mkdir(fixtureParent, { recursive: true });
  const schemaDir = await mkdtemp(join(fixtureParent, "source-pre039-schema-"));
  const projectSchema = join(process.cwd(), "src", "storage", "schema");
  for (const filename of await readdir(projectSchema)) if (filename.endsWith(".sql") && filename < "039_") await copyFile(join(projectSchema, filename), join(schemaDir, filename));
  try {
    await runMigrations({ db, schemaDir });
    const repo = new PostgresSourceContentRepository(db), now = "2026-10-13T00:00:00.000Z";
    const unresolved = await repo.createSource({ id: randomUUID(), platform: "reddit", provider: "demo_reddit", contentKind: "post", target: { type: "community", community: "legacy_unresolved" }, label: "Legacy unresolved", createdAt: now });
    const recovered = await repo.createSource({ id: randomUUID(), platform: "reddit", provider: "demo_reddit", contentKind: "post", target: { type: "community", community: "legacy_recovered" }, label: "Legacy recovered", createdAt: now });
    const failedId = randomUUID(), recoveredFailedId = randomUUID(), succeededId = randomUUID();
    for (const [id, sourceId, status, createdAt] of [
      [failedId, unresolved.id, "failed", "2026-10-12T10:00:00.000Z"],
      [recoveredFailedId, recovered.id, "failed", "2026-10-12T10:00:00.000Z"],
      [succeededId, recovered.id, "succeeded", "2026-10-12T11:00:00.000Z"],
    ]) await db.query(`INSERT INTO source_collection_job(id,collection_source_id,status,from_at,to_at,page_size,max_pages,next_run_at,created_at,finished_at,checkpoint,pages_committed,request_count,error)
      VALUES($1,$2,$3,'2026-10-11T00:00:00Z','2026-10-12T00:00:00Z',25,5,$4,$4,$4,'{"offset":25}'::jsonb,1,3,'Legacy failure history')`, [id, sourceId, status, createdAt]);
    assert.deepEqual(await runMigrations({ db }), ["039_source_failure_policy.sql", "040_bluesky_platform.sql"]);
    assert.deepEqual(await runMigrations({ db }), []);
    assert.equal((await repo.getSource(unresolved.id))!.automaticCollectionBlocked, true);
    assert.equal((await repo.getSource(recovered.id))!.automaticCollectionBlocked, false, "A later success is not retroactively blocked");
    assert.equal((await repo.getSource(unresolved.id))!.revision, 1);
    const failed = (await repo.getJob(failedId))!;
    assert.equal(failed.failureKind, "permanent"); assert.equal(failed.error, "Legacy failure history");
    assert.equal(failed.pagesCommitted, 1); assert.equal(failed.requestCount, 3); assert.deepEqual(failed.checkpoint, { offset: 25 });
    assert.equal((await repo.listJobs({ status: "failed" })).length, 2, "Migration preserves failed-job history");
    assert.ok(await repo.retryJob(failedId, now));
    assert.equal((await repo.getSource(unresolved.id))!.automaticCollectionBlocked, false);
    assert.deepEqual((await repo.getJob(failedId))!.checkpoint, { offset: 25 });
    assert.equal((await repo.getJob(failedId))!.requestCount, 3);
  } finally { await db.close(); }
});
