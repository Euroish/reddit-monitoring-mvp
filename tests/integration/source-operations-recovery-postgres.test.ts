import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, copyFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { PostgresClient } from "../../src/storage/postgres/postgres-client";
import { runMigrations } from "../../src/storage/schema/run-migrations";
import { sourceStoragePlan } from "../../src/ops/source-storage-plan";
import { PasswordHashingService } from "../../src/application/services/password-hashing.service";
import { PostgresAppUserRepository } from "../../src/storage/repositories/postgres/postgres-app-user.repository";
import { PostgresAppSessionRepository } from "../../src/storage/repositories/postgres/postgres-app-session.repository";
import { PostgresSourceContentRepository } from "../../src/storage/repositories/postgres/postgres-source-content.repository";
import { loginAppUser } from "../../src/application/use-cases/login-app-user.use-case";
import { SourceContentService } from "../../src/application/services/source-content.service";
import { ContentPersonalService } from "../../src/application/services/content-personal.service";
import { ResearchExportService } from "../../src/application/services/research-export.service";
import { DemoContentProvider } from "../../src/connectors/demo/demo-content.connector";
import { PostgresContentPersonalRepository } from "../../src/storage/repositories/postgres/postgres-content-personal.repository";
import { PostgresResearchExportRepository } from "../../src/storage/repositories/postgres/postgres-research-export.repository";
import { backfillPublicSearchIndex } from "../../src/storage/backfill-public-search-index";

const connectionString = process.env.TEST_SOURCE_DATABASE_URL;
test("native retention preview protects quota/checkpoints/evidence; snapshot backup restores accounts sources jobs budgets Saved and audit without overwriting", { skip: !connectionString }, async () => {
  const url = new URL(connectionString!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && /^\/source_validation_[a-z0-9_]+$/.test(url.pathname));
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12), database = `source_validation_recovery_${suffix}`, restored = `source_validation_restored_${suffix}`;
  const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.href }); await admin.connect();
  try { await admin.query(`CREATE DATABASE "${database}"`); } finally { await admin.end(); }
  url.pathname = `/${database}`;
  const db = new PostgresClient({ connectionString: url.href, max: 2 });
  const source = randomUUID(), content = randomUUID(), owner = randomUUID(), session = randomUUID(), invite = randomUUID();
  const cleanJob = randomUUID(), resumeJob = randomUUID(), parentJob = randomUUID(), childJob = randomUUID(), activeJob = randomUUID();
  const now = "2026-10-13T01:00:00.000Z", old = "2026-01-01T00:00:00.000Z", password = "Synthetic-recovery-password-12";
  const pgBin = process.env.PG_BIN ?? (process.platform === "win32" ? path.resolve("output/local-dev/pgsql/bin") : "/usr/bin");
  const file = `output/validation/recovery-${suffix}/fixture.dump`;
  try {
    await runMigrations({ db });
    const hash = await new PasswordHashingService().hashPassword(password);
    await db.query("INSERT INTO app_user(id,email,role,status,created_at,updated_at) VALUES($1,'recovery-owner@example.test','owner','active',$2,$2)", [owner, now]);
    await db.query("INSERT INTO app_user_password(user_id,password_hash,password_algo,updated_at) VALUES($1,$2,'scrypt',$3)", [owner, hash, now]);
    await db.query("INSERT INTO app_session(id,user_id,token_hash,expires_at,last_seen_at,created_at) VALUES($1,$2,'synthetic-retained-session','2027-01-01',$3,$3)", [session, owner, now]);
    await db.query("INSERT INTO app_invite(id,code_hash,status,role_on_accept,max_uses,created_at) VALUES($1,'synthetic-invite-hash','active','viewer',2,$2)", [invite, now]);
    await db.query("INSERT INTO saved_workbench_view(id,user_id,name,view_kind,primary_target,route_path) VALUES($1,$2,'Recovery saved','target','recovery','/target/recovery')", [randomUUID(), owner]);
    await db.query("INSERT INTO collection_source(id,platform_id,provider,label,target,content_kind,created_at,updated_at) VALUES($1,'11111111-1111-1111-1111-111111111111','demo_reddit','Synthetic recovery','{\"type\":\"community\",\"community\":\"recovery\"}','post',$2,$2)", [source, now]);
    await db.query("INSERT INTO content(id,source_id,external_id,kind,title,body_text,created_at_source,first_seen_at,last_seen_at,platform_details,availability) VALUES($1,'11111111-1111-1111-1111-111111111111','recovery-post','post','Synthetic backup','Retained synthetic body',$2,$2,$2,'{\"platform\":\"reddit\",\"community\":\"recovery\",\"flair\":null,\"nsfw\":false}','available')", [content, old]);
    await db.query("INSERT INTO content_discovery(content_id,collection_source_id,first_fetched_at,last_fetched_at) VALUES($1,$2,$3,$3)", [content, source, old]);
    for (const observation of [
      { time: old, fetched: old, basis: "archive_initial", maturity: "initial", key: "initial", metrics: { "reddit.score": 1 } },
      { time: "2026-01-02T00:00:00.000Z", fetched: "2026-01-02T00:00:00.000Z", basis: "archive_refresh", maturity: "refreshed", key: "obsolete", metrics: { "reddit.score": 2 } },
      { time: "2026-01-03T00:00:00.000Z", fetched: "2026-01-03T00:00:00.000Z", basis: "archive_refresh", maturity: "refreshed", key: "latest-known", metrics: { "reddit.score": 0, "reddit.num_comments": null } },
      { time: null, fetched: now, basis: "unknown", maturity: "unknown", key: "recent-unknown", metrics: {} },
    ]) await db.query("INSERT INTO content_observation(content_id,collection_source_id,provider,source_observed_at,fetched_at,time_basis,maturity,metrics,evidence_key) VALUES($1,$2,'demo_reddit',$3,$4,$5,$6,$7,$8)", [content, source, observation.time, observation.fetched, observation.basis, observation.maturity, observation.metrics, observation.key]);
    for (const job of [
      { id: cleanJob, status: "succeeded", checkpoint: null, exhausted: true, parent: null, at: old },
      { id: resumeJob, status: "failed", checkpoint: { page: 2 }, exhausted: false, parent: null, at: old },
      { id: parentJob, status: "succeeded", checkpoint: null, exhausted: true, parent: null, at: old },
      { id: childJob, status: "succeeded", checkpoint: null, exhausted: true, parent: parentJob, at: now },
      { id: activeJob, status: "queued", checkpoint: { page: 1 }, exhausted: false, parent: null, at: old },
    ]) await db.query("INSERT INTO source_collection_job(id,collection_source_id,status,from_at,to_at,page_size,max_pages,next_run_at,created_at,finished_at,checkpoint,exhausted,parent_job_id) VALUES($1,$2,$3,'2026-01-01','2026-01-02',25,5,$4,$4,$5,$6,$7,$8)", [job.id, source, job.status, job.at, job.status === "queued" ? null : job.at, job.checkpoint, job.exhausted, job.parent]);
    await db.query("INSERT INTO source_provider_budget(provider,enabled,daily_requests,monthly_requests,daily_resources,monthly_resources) VALUES('demo_reddit',true,20,200,100,1000)");
    await db.query("INSERT INTO source_provider_usage(provider,day,requests,resources_reserved) VALUES('demo_reddit','2026-01-01',1,1),('demo_reddit','2026-10-01',2,2),('demo_reddit','2026-11-01',3,3)");
    await db.query("INSERT INTO source_worker_heartbeat(id,started_at,last_heartbeat_at,state,last_job_id) VALUES('old-active',$1,$1,'active',$2),('old-stopped',$1,$1,'stopped',NULL),('fresh',$3,$3,'active',NULL)", [old, activeJob, now]);
    for (const [outcome, at] of [["attempted", old], ["failed", old], ["succeeded", now]])
      await db.query("INSERT INTO app_audit_log(id,actor_user_id,action,created_at,outcome) VALUES($1,$2,'synthetic.recovery',$3,$4)", [randomUUID(), owner, at, outcome]);
    await backfillPublicSearchIndex(db, { limit: 100, now });
    const publicService = new SourceContentService(new PostgresSourceContentRepository(db), new DemoContentProvider("reddit", () => now), () => now);
    const personal = new ContentPersonalService(new PostgresContentPersonalRepository(db), publicService, () => now);
    const savedQuery = await personal.saveQuery(owner, { name: "Recovery content query", query: { sourceId: source, query: "Retained" }, expectedRevision: 0 });
    await personal.saveAnnotation(owner, content, { favorite: true, note: "Private recovery note", expectedRevision: 0 });
    const frozen = await new ResearchExportService(new PostgresResearchExportRepository(db), publicService, () => now).create(owner, { name: "Recovery frozen sample", query: { sourceId: source, query: "Retained" } });
    const plan = await sourceStoragePlan(db, { jobDays: 90, observationDays: 90, heartbeatDays: 14, usageDays: 1, auditDays: 90 }, now);
    assert.equal(plan.mode, "dry-run"); assert.equal(plan.deletionExecuted, false);
    for (const table of ["content_saved_query", "content_annotation", "research_export", "research_export_member", "public_content_search_document"]) {
      assert.equal(plan.tables[table].rows, 1); assert.equal(plan.tables[table].candidates, 0);
    }
    for (const name of ["source_collection_job", "content_observation", "source_provider_usage", "source_worker_heartbeat", "app_audit_log"])
      assert.equal(plan.tables[name].candidates, 1, name);
    assert.equal((await db.query("SELECT count(*)::int AS count FROM content_observation")).rows[0].count, 4);
    const { backupDatabase, restoreDatabase } = await import("../../scripts/database-backup-lib.mjs");
    const backup = await backupDatabase({ connectionString: url.href, pgBin, file });
    assert.match(backup.sha256, /^[a-f0-9]{64}$/);
    const restoredResult = await restoreDatabase({ connectionString: url.href, pgBin, file, targetDatabase: restored });
    assert.equal(restoredResult.inventoryMatches, true);
    await assert.rejects(restoreDatabase({ connectionString: url.href, pgBin, file, targetDatabase: restored }), /already exists/);
    await assert.rejects(restoreDatabase({ connectionString: url.href, pgBin, file, targetDatabase: database.replace("source_validation_", "info_workbench_") }), /fresh/);
    const restoredUrl = new URL(url); restoredUrl.pathname = `/${restored}`;
    const restoredDb = new PostgresClient({ connectionString: restoredUrl.href, max: 2 });
    try {
      const users = new PostgresAppUserRepository(restoredDb), sessions = new PostgresAppSessionRepository(restoredDb);
      const login = await loginAppUser({ appUserRepository: users, appSessionRepository: sessions, now: () => now }, { email: "recovery-owner@example.test", password });
      assert.equal(login.user.role, "owner");
      assert.equal((await restoredDb.query("SELECT checkpoint FROM source_collection_job WHERE id=$1", [resumeJob])).rows[0].checkpoint.page, 2);
      assert.equal((await restoredDb.query("SELECT requests FROM source_provider_usage WHERE day='2026-10-01'")).rows[0].requests, 2);
      assert.equal((await restoredDb.query("SELECT outcome FROM app_audit_log WHERE outcome='attempted'")).rows.length, 1);
      assert.equal((await restoredDb.query("SELECT name FROM saved_workbench_view")).rows[0].name, "Recovery saved");
      const page = await new PostgresSourceContentRepository(restoredDb).listContent({ sourceId: source });
      assert.equal(page.items[0].text, "Retained synthetic body"); assert.equal(page.items[0].observations[0].metrics["reddit.score"], 0);
      assert.equal(page.items[0].observations[0].metrics["reddit.num_comments"], null);
      const restoredPublic = new SourceContentService(new PostgresSourceContentRepository(restoredDb), new DemoContentProvider("reddit", () => now), () => now);
      const restoredPersonal = new ContentPersonalService(new PostgresContentPersonalRepository(restoredDb), restoredPublic, () => now);
      assert.equal((await restoredPersonal.listQueries(owner)).queries[0].id, savedQuery.id);
      assert.equal((await restoredPersonal.getAnnotation(owner, content))?.note, "Private recovery note");
      const restoredResearch = await new ResearchExportService(new PostgresResearchExportRepository(restoredDb), restoredPublic, () => now).pageContent(owner, frozen.id, { limit: 100 });
      assert.equal(restoredResearch.total, 1); assert.equal(restoredResearch.items[0].text, "Retained synthetic body");
      assert.equal(restoredResearch.manifest.coverage.indexed, 1);
      assert.equal((await new PostgresSourceContentRepository(restoredDb).listContent({ sourceId: source, query: "Retained" })).items.length, 1);
    } finally { await restoredDb.close(); }
    const damaged = `output/validation/recovery-${suffix}/damaged/fixture.dump`;
    await mkdir(path.dirname(damaged), { recursive: true }); await copyFile(file, damaged); await copyFile(`${file}.manifest.json`, `${damaged}.manifest.json`);
    await appendFile(damaged, "tampered");
    await assert.rejects(restoreDatabase({ connectionString: url.href, pgBin, file: damaged, targetDatabase: `source_validation_rejected_${suffix}` }), /integrity/);
    const check = new Client({ connectionString: adminUrl.href }); await check.connect();
    try { assert.equal((await check.query("SELECT 1 FROM pg_database WHERE datname=$1", [`source_validation_rejected_${suffix}`])).rowCount, 0); } finally { await check.end(); }
    console.log(JSON.stringify({ scope: "native synthetic recovery", database, restored, retentionDeletionExecuted: false,
      archiveHashVerified: true, originalPreserved: true, accountLogin: true, jobsBudgetsSavedAuditPreserved: true, realSourceRequests: 0 }));
  } finally { await db.close(); }
});
