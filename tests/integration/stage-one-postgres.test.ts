import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../../apps/api/src/app";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { workOnce } from "../../src/modules/collection/worker";
import { KaixContentConnector } from "../../src/connectors/reddit/kaix-content.connector";
import { runMigrations } from "../../src/storage/schema/run-migrations";
import { batchItem } from "../helpers/content-batch-fixtures";
import { testDatabase } from "../helpers/database";

const origin = "http://stage.test";
test("Stage 1: strict HTTP, collect idempotency, shutdown resume, truncation, no-op replay and export limits", async t => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@example.test");
  let posts = 0;
  let interrupt = false;
  const controller = new AbortController();
  const connector = new KaixContentConnector({ networkEnabled: true, apiToken: "fixture" }, async (_, init) => {
    if (init?.method === "POST") {
      posts++;
      return Response.json({ data: { id: "stageRun", defaultDatasetId: "stageDataset", status: "RUNNING" } });
    }
    if (interrupt) {
      controller.abort();
      throw new DOMException("Stopping", "AbortError");
    }
    if (String(_).includes("actor-runs")) {
      return Response.json({ data: { id: "stageRun", defaultDatasetId: "stageDataset", status: "SUCCEEDED" } });
    }
    return Response.json([{ type: "post", id: "stage123", fullName: "t3_stage123", title: "Stage evidence",
      subreddit: "fixture", selftext: "Evidence", createdUtc: Date.now() / 1000 - 60 }]);
  });
  const app = await buildApp({ pool: db.pool, origin, secureCookies: false,
    sessionSecret: "stage-fixture-secret".repeat(3), providers: [connector], rateLimitMax: 10000 });
  t.after(() => app.close());
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", headers: { origin },
    payload: { email: "owner@example.test", password: "fixture-password-123" } });
  const headers = { origin, cookie: login.headers["set-cookie"]!.toString().split(";")[0] };
  assert.equal((await app.inject("/readyz")).statusCode, 200);
  assert.equal((await app.inject({ url: "/v1/content?illegal=true", headers })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/v1/auth/register", headers,
    payload: { email: "a@b.test", password: "fixture-password-123", invite: "bad", illegal: true } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/v1/access/keys", headers,
    payload: { label: "Invalid", scopes: ["ingest"], allowedSourceIds: [], expiresInDays: 30 } })).statusCode, 422);
  const created = await app.inject({ method: "POST", url: "/v1/sources", headers,
    payload: { label: "Shutdown fixture", platform: "reddit", primaryProvider: "kaix", deliveryMode: "pull",
      target: { type: "search", query: "evidence" }, contentKind: "post" } });
  const id = created.json().source.id;
  const body = { from: new Date(Date.now() - 86400000).toISOString(), to: new Date().toISOString(), limit: 1 };
  const collect = (payload = body) => app.inject({ method: "POST", url: `/v1/sources/${id}/collect`,
    headers: { ...headers, "idempotency-key": "same-collection" }, payload });
  assert.equal((await app.inject({ method: "POST", url: `/v1/sources/${id}/collect`, headers, payload: body })).statusCode, 400);
  const [first, replay] = await Promise.all([collect(), collect()]);
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().jobId, replay.json().jobId);
  assert.equal((await collect({ ...body, limit: 2 })).statusCode, 409);
  await db.pool.query("UPDATE source_provider_budget SET enabled=TRUE,daily_requests=10,monthly_requests=10,daily_resources=1000,monthly_resources=1000 WHERE provider='kaix'");
  await workOnce(db.pool, [connector]);
  const jobId = first.json().jobId;
  await db.pool.query("UPDATE source_collection_job SET next_run_at=NOW() WHERE id=$1", [jobId]);
  interrupt = true;
  await workOnce(db.pool, [connector], controller.signal);
  const stopped = (await db.pool.query(`SELECT j.status,j.provider_state,cs.automatic_collection_blocked FROM source_collection_job j
    JOIN collection_source cs ON cs.id=j.collection_source_id WHERE j.id=$1`, [jobId])).rows[0];
  assert.equal(stopped.status, "queued");
  assert.equal(stopped.provider_state.runId, "stageRun");
  assert.equal(stopped.automatic_collection_blocked, false);
  interrupt = false;
  await workOnce(db.pool, [connector]);
  assert.equal(posts, 1, "Shutdown resumes the persisted run without purchasing again");
  const finished = (await db.pool.query("SELECT status,exhausted FROM source_collection_job WHERE id=$1", [jobId])).rows[0];
  assert.equal(finished.status, "succeeded");
  assert.equal(finished.exhausted, false);
  assert.equal((await db.pool.query("SELECT incremental_to FROM collection_source WHERE id=$1", [id])).rows[0].incremental_to, null);

  const push = await app.inject({ method: "POST", url: "/v1/sources", headers,
    payload: { label: "Replay", platform: "reddit", primaryProvider: "external_ingest", deliveryMode: "push",
      contentKind: "post", target: { type: "search", query: "Replay" } } });
  const sourceId = push.json().source.id;
  const a = batchItem(sourceId, { externalId: "t3_replay1" });
  a.observation.provider = "external_ingest";
  const b = batchItem(sourceId, { externalId: "t3_replay2", id: a.id, observation: { ...a.observation, evidenceKey: "b" } });
  const ingest = (key: string, items = [a, b]) => app.inject({ method: "POST", url: `/v1/sources/${sourceId}/ingest`,
    headers: { ...headers, "idempotency-key": key }, payload: { items } });
  const written = await ingest("first");
  assert.equal(written.statusCode, 201, written.body);
  assert.equal(written.json().added, 2, "Client UUID collisions cannot collide server identities");
  const before = (await db.pool.query("SELECT indexed_at FROM public_content_search_document ORDER BY content_id")).rows;
  const again = await ingest("second");
  assert.equal(again.statusCode, 201, again.body);
  assert.equal(again.json().updated, 0);
  assert.deepEqual((await db.pool.query("SELECT indexed_at FROM public_content_search_document ORDER BY content_id")).rows, before);
  const missingId = { ...a } as Partial<typeof a>;
  delete missingId.id;
  assert.equal((await app.inject({ method: "POST", url: `/v1/sources/${sourceId}/ingest`,
    headers: { ...headers, "idempotency-key": "no-client-id" }, payload: { items: [missingId] } })).statusCode, 201);
  const exported = await app.inject({ url: `/v1/content/export?sourceId=${sourceId}&maxRows=1`, headers });
  assert.equal(exported.statusCode, 200, exported.body);
  assert.equal(exported.json().items.length, 1);
  assert.equal(exported.json().result.complete, true);
  assert.equal(exported.json().result.truncated, true);
  assert.ok(exported.json().result.nextCursor);
  assert.equal((await app.inject({ url: "/v1/content/export?maxRows=50001", headers })).statusCode, 400);
  const spec = (await app.inject({ url: "/v1/openapi.json", headers })).json();
  for (const methods of Object.values(spec.paths) as Record<string, { operationId: string }>[]) {
    for (const operation of Object.values(methods)) assert.ok(operation.operationId);
  }
});

test("migration runner rejects empty SQL directories and overrides short runtime statement timeout", async t => {
  const db = await testDatabase();
  t.after(db.close);
  const directory = await mkdtemp(join(tmpdir(), "stage-migration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(runMigrations({ pool: db.pool, schemaDir: directory }), /No SQL migrations/);
  await writeFile(join(directory, "099_timeout_fixture.sql"), "DO $$ BEGIN IF current_setting('statement_timeout') <> '10min' THEN RAISE EXCEPTION 'short timeout'; END IF; END $$;");
  await runMigrations({ pool: db.pool, schemaDir: directory });
  await writeFile(join(directory, "099_duplicate_fixture.sql"), "SELECT 1;");
  await assert.rejects(runMigrations({ pool: db.pool, schemaDir: directory }), /Duplicate migration/);
});

test("single trusted proxy hop isolates client rate limits and ignores spoofed leading hops", async t => {
  const db = await testDatabase();
  t.after(db.close);
  const app = await buildApp({ pool: db.pool, origin, sessionSecret: "stage-fixture-secret".repeat(3),
    secureCookies: false, trustedProxyAddress: "172.20.0.2", rateLimitMax: 2 });
  t.after(() => app.close());
  const call = (forwarded: string) => app.inject({ url: "/v1/auth/session", remoteAddress: "172.20.0.2",
    headers: { "x-forwarded-for": forwarded } });
  assert.equal((await call("192.0.2.1")).statusCode, 200);
  assert.equal((await call("192.0.2.1")).statusCode, 200);
  assert.equal((await call("192.0.2.1")).statusCode, 429);
  assert.equal((await call("198.51.100.99, 192.0.2.1")).statusCode, 429);
  assert.equal((await call("192.0.2.2")).statusCode, 200);
});
