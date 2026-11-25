import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { testDatabase } from "../helpers/database";

async function loginAs(
  app: Awaited<ReturnType<typeof buildApp>>,
  origin: string,
  email: string,
  password: string,
) {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { origin },
    payload: { email, password },
  });
  assert.equal(res.statusCode, 200, res.body);
  return { origin, cookie: res.headers["set-cookie"]!.toString().split(";")[0] };
}

test("PG16 research workbench: scope, L1 deduplication, L2 Jaccard + cache, and L3 async tasks + evidence drilldown", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@research.test");
  const origin = "http://research.test";
  const app = await buildApp({
    pool: db.pool,
    origin,
    secureCookies: false,
    sessionSecret: "research-pg-fixture".repeat(3),
    providers: [],
    publicRead: true,
    publicRegistration: true,
  });
  t.after(() => app.close());

  const ownerHeaders = await loginAs(app, origin, "owner@research.test", "fixture-password-123");

  const { rows: platRows } = await db.pool.query<{ id: string; code: string }>(
    `SELECT id, code FROM source WHERE code IN ('reddit', 'x')`,
  );
  const redditPlat = platRows.find((r) => r.code === "reddit")!.id;
  const _xPlat = platRows.find((r) => r.code === "x")!.id;

  const srcA = randomUUID();
  const srcB = randomUUID();
  await db.pool.query(
    `INSERT INTO collection_source(id, platform_id, primary_provider, delivery_mode, label, target, content_kind, state, created_at, updated_at)
     VALUES ($1, $2, 'external_ingest', 'push', 'Keyword A', '{"type":"search","query":"Keyword A"}'::jsonb, 'post', 'active', now(), now()),
            ($3, $4, 'external_ingest', 'push', 'Keyword B', '{"type":"search","query":"Keyword B"}'::jsonb, 'post', 'active', now(), now())`,
    [srcA, redditPlat, srcB, redditPlat],
  );

  const mkItem = (
    sourceId: string,
    platform: "reddit" | "x",
    kind: "post" | "comment",
    externalId: string,
    title: string | null,
    text: string,
    publishedAt: string,
  ) => ({
    platform,
    kind,
    externalId,
    title,
    text,
    url: `https://${platform === "reddit" ? "reddit.com/r/LocalLLaMA" : "x.com"}/${externalId}`,
    language: "en",
    author: {
      externalId: `uid_${externalId}`,
      handle: `user_${externalId}`,
      displayName: `User ${externalId}`,
      url: null,
    },
    publishedAt,
    fetchedAt: publishedAt,
    availability: "available" as const,
    references: [],
    media: [],
    platformDetails:
      platform === "reddit"
        ? { platform: "reddit" as const, community: "LocalLLaMA", flair: null, nsfw: false }
        : { platform: "x" as const, conversationId: null, isReply: false, isRepost: false, isQuote: false, sensitive: false },
    observation: {
      provider: "external_ingest",
      sourceId,
      sourceObservedAt: publishedAt,
      fetchedAt: publishedAt,
      timeBasis: "provider_snapshot" as const,
      maturity: "unknown" as const,
      metrics: platform === "reddit" ? { "reddit.score": 42, "reddit.num_comments": 7 } : { "x.likes": 12, "x.replies": 2 },
      evidenceKey: `ev-${sourceId}-${externalId}`,
    },
  });

  // Seed §5.12 B dataset across Batch A1 (3 items), Batch A2 (1 item), Batch B1 (2 items sharing c1 across targets)
  const ingA1 = await app.inject({
    method: "POST",
    url: `/v1/sources/${srcA}/ingest`,
    headers: { ...ownerHeaders, "idempotency-key": "res-a1" },
    payload: {
      items: [
        mkItem(srcA, "reddit", "post", "t3_res1", "Cursor agent fast workflow", "Cursor agent works super well despite minor bug", "2026-11-20T10:00:00.000Z"),
        mkItem(srcA, "reddit", "post", "t3_res2", "Cursor billing price", "Monthly subscription cost is too expensive", "2026-11-21T10:00:00.000Z"),
        mkItem(srcA, "reddit", "comment", "t1_res3", null, "Great latency improvement on local setup!", "2026-11-21T12:00:00.000Z"),
      ],
    },
  });
  assert.equal(ingA1.statusCode, 201, ingA1.body);
  const bA1 = (ingA1.json() as { batchId: string }).batchId;

  const ingA2 = await app.inject({
    method: "POST",
    url: `/v1/sources/${srcA}/ingest`,
    headers: { ...ownerHeaders, "idempotency-key": "res-a2" },
    payload: {
      items: [
        mkItem(srcA, "reddit", "post", "t3_res4", "Release v2.1 docs", "Released v2.1 documentation today.", "2026-11-22T09:00:00.000Z"),
      ],
    },
  });
  assert.equal(ingA2.statusCode, 201, ingA2.body);
  const bA2 = (ingA2.json() as { batchId: string }).batchId;

  const ingB1 = await app.inject({
    method: "POST",
    url: `/v1/sources/${srcB}/ingest`,
    headers: { ...ownerHeaders, "idempotency-key": "res-b1" },
    payload: {
      items: [
        mkItem(srcB, "reddit", "post", "t3_res1", "Cursor agent fast workflow", "Cursor agent works super well despite minor bug", "2026-11-20T10:00:00.000Z"),
        mkItem(srcB, "reddit", "comment", "t1_res5", null, "Terrible crash and outage today", "2026-11-23T08:00:00.000Z"),
      ],
    },
  });
  assert.equal(ingB1.statusCode, 201, ingB1.body);
  const bB1 = (ingB1.json() as { batchId: string }).batchId;

  const projRes = await app.inject({
    method: "POST",
    url: "/v1/projects",
    headers: ownerHeaders,
    payload: { name: "PG Research Project", sourceIds: [srcA, srcB], datasetMode: "batch", visibility: "shared" },
  });
  assert.equal(projRes.statusCode, 200, projRes.body);
  const projectId = (projRes.json() as { id: string }).id;

  for (const batchId of [bA1, bA2, bB1]) {
    const att = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/batches`,
      headers: ownerHeaders,
      payload: { batchId },
    });
    assert.equal(att.statusCode, 200, att.body);
  }

  // L1 deduplication check (total=5, overlap=1)
  const l1Res = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/research/l1`,
    headers: ownerHeaders,
    payload: { lang: "zh" },
  });
  assert.equal(l1Res.statusCode, 200, l1Res.body);
  const l1Body = l1Res.json() as { analyses: { scale: { data: { deduplicatedContentCount: number; multiTargetOverlapCount: number } } } };
  assert.equal(l1Body.analyses.scale.data.deduplicatedContentCount, 5);
  assert.equal(l1Body.analyses.scale.data.multiTargetOverlapCount, 1);

  // L2 comparison + PG16 cache hit check + Jaccard 20%
  const l2First = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/research/l2`,
    headers: ownerHeaders,
    payload: { lang: "zh" },
  });
  assert.equal(l2First.statusCode, 200, l2First.body);
  const l2FirstJson = l2First.json() as {
    cacheStatus: string;
    analyses: { overlapMatrix: { data: { cells: Array<{ rowLabel: string; colLabel: string; jaccardPct: number }> } } };
  };
  assert.equal(l2FirstJson.cacheStatus, "miss");
  const ab = l2FirstJson.analyses.overlapMatrix.data.cells.find(
    (c) => c.rowLabel === "Keyword A" && c.colLabel === "Keyword B",
  );
  assert.equal(ab?.jaccardPct, 20);

  const l2Second = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/research/l2`,
    headers: ownerHeaders,
    payload: { lang: "zh" },
  });
  assert.equal(l2Second.statusCode, 200);
  assert.equal((l2Second.json() as { cacheStatus: string }).cacheStatus, "hit");

  const byBatch = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/research/l2`,
    headers: ownerHeaders,
    payload: { lang: "zh", compareMode: "batch" },
  });
  assert.equal(byBatch.statusCode, 200, byBatch.body);
  const batchCells = (byBatch.json() as typeof l2FirstJson).analyses.overlapMatrix.data.cells;
  assert.equal(batchCells.length, 9);
  assert.ok(batchCells.some((cell) => cell.rowLabel !== cell.colLabel && cell.jaccardPct === 25));

  // L3 Sentiment task queue -> poll to completion -> inspect evidence -> delete
  const taskCreate = await app.inject({
    method: "POST",
    url: `/v1/projects/${projectId}/research/tasks`,
    headers: ownerHeaders,
    payload: { taskType: "sentiment", scope: { lang: "zh" }, config: { sampleLimit: 500 } },
  });
  assert.equal(taskCreate.statusCode, 202, taskCreate.body);
  const createdId = (taskCreate.json() as { task: { id: string } }).task.id;

  let finalStatus = "queued";
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const pollRes = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/research/tasks/${createdId}`,
      headers: ownerHeaders,
    });
    assert.equal(pollRes.statusCode, 200);
    finalStatus = (pollRes.json() as { task: { status: string } }).task.status;
    if (finalStatus === "succeeded" || finalStatus === "failed") break;
  }
  assert.equal(finalStatus, "succeeded");

  const evRes = await app.inject({
    method: "GET",
    url: `/v1/projects/${projectId}/research/tasks/${createdId}/evidence?sentiment=unclassified`,
    headers: ownerHeaders,
  });
  assert.equal(evRes.statusCode, 200, evRes.body);
  const evJson = evRes.json() as { items: Array<{ externalId: string }> };
  assert.ok(evJson.items.some((x) => x.externalId === "t3_res4"), "Objective release note belongs in unclassified evidence slice");

  const delRes = await app.inject({
    method: "DELETE",
    url: `/v1/projects/${projectId}/research/tasks/${createdId}`,
    headers: ownerHeaders,
  });
  assert.equal(delRes.statusCode, 200);
});
