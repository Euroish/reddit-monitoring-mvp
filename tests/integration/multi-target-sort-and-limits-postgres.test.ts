import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { buildApp } from "../../apps/api/src/app";
import { KaixContentConnector } from "../../src/connectors/reddit/kaix-content.connector";
import { twitterApis } from "../../src/connectors/x/twitterapis";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { workOnce } from "../../src/modules/collection/worker";
import { attachBatchToProjectInTx } from "../../src/modules/projects/index";
import { testDatabase } from "../helpers/database";

const ORIGIN = "https://limits-and-sort.test";

test("tier limits (free=2000, pro=5000, admin=10000/500 comments), X multi-page on-demand collect, and engagement sorting", async (t) => {
  const db = await testDatabase();
  t.after(db.close);

  const password = "fixture-password-123";
  await bootstrapOwner(db.pool, password, "owner@limits.test");

  const kaix = new KaixContentConnector({ networkEnabled: true, apiToken: "fixture-token" }, async () =>
    new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } }),
  );
  const nowMs = Date.now();
  const xCalls: Array<string | null> = [];
  const x = twitterApis(
    { SOURCE_NETWORK_ENABLED: "true", TWITTERAPIS_API_KEY: "fixture-x-key" },
    async (input) => {
      const url = new URL(input.toString());
      const cursor = url.searchParams.get("cursor");
      xCalls.push(cursor);
      const pageIdx = cursor === "p2" ? 1 : cursor === "p3" ? 2 : 0;
      const count = pageIdx < 2 ? 20 : 5;
      const tweets = Array.from({ length: count }, (_, idx) => {
        const seq = pageIdx * 20 + idx + 1;
        return {
          id: String(9000000 + seq),
          created_at: new Date(nowMs - seq * 60_000).toISOString(),
          text: `Synthetic X discussion #${seq}`,
          author: { username: "researcher" },
          favorite_count: seq === 3 ? 500 : seq === 1 ? 10 : seq * 2,
          reply_count: seq === 3 ? 80 : seq === 2 ? 400 : seq,
        };
      });
      return new Response(
        JSON.stringify({
          tweets,
          next_cursor: pageIdx === 0 ? "p2" : pageIdx === 1 ? "p3" : null,
          has_more: pageIdx < 2,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );

  await db.pool.query(
    `UPDATE source_provider_budget
     SET enabled=true, daily_requests=10000, monthly_requests=100000, daily_resources=100000, monthly_resources=1000000, minimum_interval_ms=0
     WHERE provider IN ('kaix','twitterapis')`,
  );

  const app = await buildApp({
    pool: db.pool,
    providers: [kaix, x],
    origin: ORIGIN,
    secureCookies: false,
    sessionSecret: "synthetic-limits-secret-".repeat(3),
    rateLimitMax: 400,
  });
  t.after(() => app.close());

  const loginRes = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { origin: ORIGIN },
    payload: { email: "owner@limits.test", password },
  });
  assert.equal(loginRes.statusCode, 200);
  const ownerCookie = loginRes.cookies[0]!.name + "=" + loginRes.cookies[0]!.value;

  const projectRes = await app.inject({
    method: "POST",
    url: "/v1/projects",
    headers: { origin: ORIGIN, cookie: ownerCookie },
    payload: { name: "Multi-target & Engagement Project", datasetMode: "batch", sourceIds: [], filter: {} },
  });
  assert.equal(projectRes.statusCode, 200);
  const projectId = projectRes.json().id as string;

  const from = new Date(nowMs - 7 * 86_400_000).toISOString();
  const to = new Date(nowMs + 60_000).toISOString();

  // 1. Admin preview exposes 10000 posts & 500 comments for Reddit, 10000 posts for X
  const redditPreview = await app.inject({
    method: "POST",
    url: "/v1/research/collection-plans/preview",
    headers: { origin: ORIGIN, cookie: ownerCookie },
    payload: {
      projectId, platform: "reddit", targetType: "community", targetValue: "r/LocalLLaMA",
      from, to, limit: 10000, includeComments: true, maxCommentsPerPost: 500,
    },
  });
  assert.equal(redditPreview.statusCode, 200, redditPreview.body);
  const rp = redditPreview.json();
  assert.equal(rp.executable, true);
  assert.equal(rp.fieldPolicy.maxBatchLimit, 10000);
  assert.equal(rp.fieldPolicy.maxCommentsPerPost, 500);

  const xPreview = await app.inject({
    method: "POST",
    url: "/v1/research/collection-plans/preview",
    headers: { origin: ORIGIN, cookie: ownerCookie },
    payload: {
      projectId, platform: "x", targetType: "search", targetValue: "siftline",
      from, to, limit: 10000,
    },
  });
  assert.equal(xPreview.statusCode, 200, xPreview.body);
  const xp = xPreview.json();
  assert.equal(xp.executable, true);
  assert.equal(xp.fieldPolicy.maxBatchLimit, 10000);
  assert.equal(xp.estimate.requests, 500);

  // 2. Multi-target collect into the same project (two Reddit communities + one X multi-page run)
  for (const community of ["r/LocalLLaMA", "r/ClaudeAI"]) {
    const res = await app.inject({
      method: "POST",
      url: "/v1/research/collection-plans/collect",
      headers: { origin: ORIGIN, cookie: ownerCookie, "idempotency-key": randomUUID() },
      payload: { projectId, platform: "reddit", targetType: "community", targetValue: community, from, to, limit: 50 },
    });
    assert.equal(res.statusCode, 200, res.body);
  }
  const queuedReddit = await db.pool.query(
    "SELECT count(*)::int AS cnt FROM source_collection_job WHERE request_json->>'projectId'=$1 AND provider='kaix'",
    [projectId],
  );
  assert.equal(queuedReddit.rows[0].cnt, 2);
  // Cancel those two synthetic kaix jobs so worker runs the X multi-page job cleanly
  await db.pool.query("UPDATE source_collection_job SET status='cancelled' WHERE provider='kaix'");

  // 3. X on-demand collect with limit=45 -> page_size=20, max_pages=3 -> worker paginates all 3 pages into projectId
  const xCollect = await app.inject({
    method: "POST",
    url: "/v1/research/collection-plans/collect",
    headers: { origin: ORIGIN, cookie: ownerCookie, "idempotency-key": randomUUID() },
    payload: { projectId, platform: "x", targetType: "search", targetValue: "siftline", from, to, limit: 45 },
  });
  assert.equal(xCollect.statusCode, 200, xCollect.body);
  const xJobId = xCollect.json().jobId as string;
  const xJobRow = (await db.pool.query("SELECT page_size, max_pages FROM source_collection_job WHERE id=$1", [xJobId])).rows[0];
  assert.equal(xJobRow.page_size, 20);
  assert.equal(xJobRow.max_pages, 3);

  for (let i = 0; i < 3; i++) {
    const worked = await workOnce(db.pool, [kaix, x], undefined, undefined, {
      onProjectBatchCommitted: attachBatchToProjectInTx,
    });
    assert.equal(worked, true);
  }
  assert.deepEqual(xCalls, [null, "p2", "p3"]);
  const finishedJob = (await db.pool.query("SELECT status, pages_committed, records_processed FROM source_collection_job WHERE id=$1", [xJobId])).rows[0];
  assert.equal(finishedJob.status, "succeeded");
  assert.equal(finishedJob.pages_committed, 3);
  assert.equal(finishedJob.records_processed, 45);

  // 4. Engagement sorting returns highest (comments + likes) first and paginates deterministically
  const page1 = await app.inject({
    method: "GET",
    url: `/v1/projects/${projectId}/content?sort=engagement&limit=3`,
    headers: { cookie: ownerCookie },
  });
  assert.equal(page1.statusCode, 200, page1.body);
  const body1 = page1.json();
  assert.equal(body1.items.length, 3);
  assert.equal(body1.items[0].externalId, "9000003"); // 500 likes + 80 replies = 580
  assert.equal(body1.items[1].externalId, "9000002"); // 4 likes + 400 replies = 404
  assert.equal(body1.items[2].externalId, "9000045"); // 90 likes + 45 replies = 135
  assert.ok(body1.nextCursor);

  const page2 = await app.inject({
    method: "GET",
    url: `/v1/projects/${projectId}/content?sort=engagement&limit=3&cursor=${encodeURIComponent(body1.nextCursor)}`,
    headers: { cookie: ownerCookie },
  });
  assert.equal(page2.statusCode, 200, page2.body);
  const body2 = page2.json();
  assert.equal(body2.items.length, 3);
  assert.equal(body2.items[0].externalId, "9000044"); // 88 likes + 44 replies = 132
  assert.equal(body2.items[1].externalId, "9000043");
  assert.equal(body2.items[2].externalId, "9000042");

  // 5. Verify free=2000 and pro=5000 plan defaults from migration 067
  const plans = (await db.pool.query("SELECT plan_tier, max_batch_limit FROM plan_collection_policy ORDER BY plan_tier")).rows;
  assert.deepEqual(plans, [
    { plan_tier: "free", max_batch_limit: 2000 },
    { plan_tier: "pro", max_batch_limit: 5000 },
  ]);
});
