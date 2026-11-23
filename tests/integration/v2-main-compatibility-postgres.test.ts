import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "../../apps/api/src/app";
import { bootstrapOwner } from "../../src/modules/access/index";
import { recordCommittedBatch } from "../../src/modules/collection/batches";
import { workOnce, type WorkerHooks } from "../../src/modules/collection/worker";
import { attachBatchToProjectInTx } from "../../src/modules/projects/index";
import { webSource } from "../../src/connectors/web/sources";
import { transaction } from "../../src/storage/db";
import { testDatabase } from "../helpers/database";

test("PG16 main + V2: transactional project attachment, isolated post-commit failure, batch deltas and source history", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@example.test");
  const origin = "http://compatibility.test";
  let fetches = 0;
  const feed = webSource("feed", { SOURCE_NETWORK_ENABLED: "true", FEED_ALLOWED_URLS: "https://compatibility.example/rss" }, async () => {
    fetches++;
    return { status: 200, body: `<rss version="2.0"><channel><title>Compatibility</title>
      <item><title>Real fixture</title><link>https://compatibility.example/item</link></item>
      </channel></rss>` };
  });
  const app = await buildApp({ pool: db.pool, origin, secureCookies: false,
    sessionSecret: "compatibility-secret".repeat(3), providers: [feed] });
  t.after(() => app.close());
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", headers: { origin },
    payload: { email: "owner@example.test", password: "fixture-password-123" } });
  assert.equal(login.statusCode, 200, login.body);
  const headers = { origin, cookie: login.headers["set-cookie"]!.toString().split(";")[0] };
  const source = await app.inject({ method: "POST", url: "/v1/sources", headers,
    payload: { platform: "web", primaryProvider: "feed", deliveryMode: "pull", label: "Compatibility",
      contentKind: "article", target: { type: "feed", url: "https://compatibility.example/rss" },
      feedLane: "release", qualityGrade: "curated" } });
  assert.equal(source.statusCode, 200, source.body);
  const sourceId = source.json().source.id as string;
  assert.equal(source.json().source.usageDomain, "feed");
  assert.equal(source.json().source.feedLane, "release");
  const project = await app.inject({ method: "POST", url: "/v1/projects", headers,
    payload: { name: "Compatibility", datasetMode: "batch" } });
  assert.equal(project.statusCode, 200, project.body);
  const projectId = project.json().id as string;
  await db.pool.query("UPDATE source_provider_budget SET enabled=true,daily_requests=100,monthly_requests=100,daily_resources=1000,monthly_resources=1000,minimum_interval_ms=0 WHERE provider='feed'");
  const collect = await app.inject({ method: "POST", url: `/v1/sources/${sourceId}/collect`,
    headers: { ...headers, "idempotency-key": "compatibility-run" }, payload: { projectId,
      from: new Date(Date.now() - 86400000).toISOString(), to: new Date().toISOString(), limit: 5 } });
  assert.equal(collect.statusCode, 200, collect.body);
  const jobId = collect.json().jobId as string;
  let afterCommitCalls = 0;
  let observedCommit: unknown;
  const hooks: WorkerHooks = {
    onProjectBatchCommitted: async (client, info) => {
      await attachBatchToProjectInTx(client, info);
      throw new Error("Synthetic project attachment failure");
    },
    onSourceContentCommitted: async (id, result) => {
      afterCommitCalls++;
      // Capture assertions outside the hook: its errors are deliberately isolated.
      const committed = await db.pool.query("SELECT batch_id FROM monitor_project_batch WHERE project_id=$1", [projectId]);
      observedCommit = { id, result, linkedBatches: committed.rowCount };
      throw new Error("Synthetic rollup failure");
    },
  };
  assert.equal(await workOnce(db.pool, [feed], undefined, undefined, hooks), true);
  assert.equal(afterCommitCalls, 0);
  for (const table of ["content", "collection_batch", "monitor_project_batch"]) {
    assert.equal((await db.pool.query(`SELECT 1 FROM ${table}`)).rowCount, 0, `${table} rolls back with attachment`);
  }
  // Retry a safe, free provider; the failed transaction must not leave a partial page or batch.
  await db.pool.query("UPDATE source_collection_job SET status='queued',next_run_at=now(),provider_state='{}' WHERE id=$1", [jobId]);
  hooks.onProjectBatchCommitted = attachBatchToProjectInTx;
  assert.equal(await workOnce(db.pool, [feed], undefined, undefined, hooks), true);
  assert.equal(afterCommitCalls, 1);
  assert.deepEqual(observedCommit, { id: sourceId, result: { changed: true, hydration: false }, linkedBatches: 1 });
  assert.equal(fetches, 2);
  assert.equal((await db.pool.query("SELECT status FROM source_collection_job WHERE id=$1", [jobId])).rows[0].status, "succeeded");
  assert.equal(await workOnce(db.pool, [feed], undefined, undefined, hooks), false);
  assert.equal(fetches, 2, "post-commit failure never replays collection");

  const ids = (await db.pool.query<{ id: string }>("SELECT id FROM content")).rows.map(row => row.id);
  const record = () => transaction(db.pool, client => recordCommittedBatch(client, {
    jobId, sourceId, sourceLabel: "Compatibility", userId: null, contentIds: [...ids, ...ids],
  }));
  const replayed = await Promise.all([record(), record(), record()]);
  assert.ok(replayed.every(batch => batch.itemCount === 1));
  assert.equal(new Set(replayed.map(batch => batch.batchId)).size, 1);
  // A second page with overlap increments by actual inserted memberships only.
  const second = await db.pool.query<{ id: string }>(
    `INSERT INTO content SELECT (jsonb_populate_record(NULL::content, to_jsonb(c) ||
       jsonb_build_object('id',$1::text,'external_id','second-page','url','https://compatibility.example/second'))).*
     FROM content c LIMIT 1 RETURNING id`, [randomUUID()],
  );
  const next = await transaction(db.pool, client => recordCommittedBatch(client, {
    jobId, sourceId, sourceLabel: "Compatibility", userId: null, contentIds: [...ids, second.rows[0].id],
  }));
  assert.equal(next.itemCount, 2);
  assert.equal((await record()).itemCount, 2);

  // Job retention may remove an empty run while its batch remains a historical artifact.
  const empty = await app.inject({ method: "POST", url: "/v1/sources", headers,
    payload: { platform: "reddit", primaryProvider: "external_ingest", deliveryMode: "push", label: "Retained history",
      contentKind: "post", target: { type: "search", query: "retained" } } });
  assert.equal(empty.statusCode, 200, empty.body);
  const emptySourceId = empty.json().source.id;
  await db.pool.query("INSERT INTO collection_batch(id,collection_source_id,label) VALUES($1,$2,'Empty retained batch')", [randomUUID(), emptySourceId]);
  const removed = await app.inject({ method: "DELETE", url: `/v1/sources/${emptySourceId}`, headers });
  assert.equal(removed.statusCode, 200, removed.body);
  assert.equal(removed.json().mode, "archived", "retained batch prevents FK failure and source deletion");
});
