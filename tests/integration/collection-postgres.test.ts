import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { startWorker, workOnce } from "../../src/modules/collection/worker";
import { KaixContentConnector } from "../../src/connectors/reddit/kaix-content.connector";
import { BlueskyAppViewContentConnector } from "../../src/connectors/bluesky/bluesky-appview-content.connector";
import { scheduleDueSourcesOnce } from "../../src/modules/collection/schedule";
import { authorizeScheduledSourceDispatch } from "../../src/modules/intelligence/index";
import { webSource } from "../../src/connectors/web/sources";
import { testDatabase } from "../helpers/database";

const origin = "http://workbench.test";

test("PG16 stages share one batch, reserve per Run, and do not replay an uncertain hydration", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@example.test");
  await db.pool.query(`UPDATE source_provider_budget SET enabled=true, daily_requests=30,
    monthly_requests=30, daily_resources=20000, monthly_resources=20000 WHERE provider='kaix'`);
  let jobId = "";
  let failHydration = false;
  const inputs: Array<{ mode: string; subreddit?: string; maxItems?: number; postUrls?: string[] }> = [];
  const to = new Date();
  const post = (id: string, ageDays: number, numComments = 0) => ({
    type: "post", id, subreddit: "fixture", createdUtc: to.getTime() / 1000 - ageDays * 86400,
    title: "Fixture", numComments,
  });
  const seed = Array.from({ length: 250 }, (_, i) => post(`seed${i}`, 1, i === 0 ? 1 : 0));
  const older = post("older", 45, 5);
  const connector = new KaixContentConnector({ networkEnabled: true, apiToken: "synthetic-token" }, async (_, init) => {
    if (init?.method === "POST") {
      const { rows: [row] } = await db.pool.query("SELECT provider_state,request_count,provider_run_id FROM source_collection_job WHERE id=$1", [jobId]);
      assert.deepEqual(row.provider_state, { phase: "starting" });
      assert.equal(row.provider_run_id, null);
      assert.equal(row.request_count, inputs.length % 3 + 1);
      const input = JSON.parse(String(init.body));
      inputs.push(input);
      if (failHydration && input.mode === "post") throw new Error("ambiguous paid POST fixture");
      return Response.json({ data: { id: `run${inputs.length}`, defaultDatasetId: "fixtureDataset", status: "SUCCEEDED" } });
    }
    const input = inputs.at(-1)!;
    if (input.mode === "post") return Response.json([older, seed[0], ...input.postUrls!.map((id, i) => ({
      type: "comment", id: `reply${i}`, subreddit: "fixture", createdUtc: to.getTime() / 1000 - 86400,
      linkId: id, parentId: id, body: "Fixture reply",
    }))]);
    return Response.json(input.subreddit ? [older] : seed);
  });
  const app = await buildApp({ pool: db.pool, sessionSecret: "staged-fixture-".repeat(3), origin, secureCookies: false, providers: [connector] });
  t.after(() => app.close());
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", headers: { origin },
    payload: { email: "owner@example.test", password: "fixture-password-123" } });
  const headers = { cookie: login.headers["set-cookie"]!.toString().split(";")[0], origin };
  const scope = { from: new Date(to.getTime() - 90 * 86400000).toISOString(), to: to.toISOString(),
    limit: 251, includeComments: true, maxCommentsPerPost: 2 };
  const createJob = async (query: string) => {
    const source = await app.inject({ method: "POST", url: "/v1/sources", headers,
      payload: { platform: "reddit", primaryProvider: "kaix", deliveryMode: "pull", label: query,
        target: { type: "search", query }, contentKind: "post" } });
    assert.equal(source.statusCode, 200, source.body);
    const sourceId = source.json().source.id;
    const preview = await app.inject({ method: "POST", url: "/v1/research/collection-plans/preview", headers,
      payload: { ...scope, sourceId } });
    assert.equal(preview.statusCode, 200, preview.body);
    assert.deepEqual(preview.json().estimate, { requests: 8, systemResources: 1659, personalResources: 1651 });
    const collected = await app.inject({ method: "POST", url: `/v1/sources/${sourceId}/collect`,
      headers: { ...headers, "idempotency-key": randomUUID() }, payload: scope });
    assert.equal(collected.statusCode, 200, collected.body);
    jobId = collected.json().jobId;
  };
  const job = async () => (await db.pool.query("SELECT * FROM source_collection_job WHERE id=$1", [jobId])).rows[0];
  await createJob("Staged success");
  assert.equal((await job()).max_pages, 8);
  for (const phase of ["fanout", "hydrate_comments"]) {
    assert.equal(await workOnce(db.pool, [connector]), true);
    const state = await job();
    assert.equal(state.status, "queued");
    assert.equal(state.checkpoint.phase, phase);
    assert.deepEqual(state.provider_state, {});
    assert.equal(state.page_request_attempts, 0);
  }
  assert.equal((await job()).records_processed, scope.limit);
  assert.equal(await workOnce(db.pool, [connector]), true);
  assert.equal((await job()).status, "succeeded");
  assert.equal((await job()).records_processed, 253);
  assert.equal((await job()).coverage, "partial");
  assert.deepEqual(inputs.map(input => input.maxItems ?? input.postUrls), [251, 1, ["t3_older", "t3_seed0"]]);
  assert.deepEqual((await db.pool.query("SELECT item_count FROM collection_batch WHERE job_id=$1", [jobId])).rows, [{ item_count: 253 }]);
  assert.deepEqual((await db.pool.query("SELECT requests,resources_reserved FROM source_provider_usage WHERE provider='kaix'")).rows,
    [{ requests: 3, resources_reserved: 261 }]);

  failHydration = true;
  await createJob("Staged interruption");
  for (let i = 0; i < 3; i++) assert.equal(await workOnce(db.pool, [connector]), true);
  assert.equal((await job()).status, "failed");
  assert.equal((await job()).provider_state.phase, "unknown");
  assert.equal((await job()).pages_committed, 2);
  assert.equal(await workOnce(db.pool, [connector]), false);
  assert.equal(inputs.length, 6);
});
test("PG16 paid state resumes after interruption, fences unknown starts, budgets, cancellation and stale leases", async (t) => {
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@example.test");
  let mode: "success" | "interrupt" | "pause" = "success",
    posts = 0,
    reads = 0;
  let sourceId = "";
  let runInput: { mode?: string; commentSort?: string } = {};
  const now = new Date().toISOString();
  const connector = new KaixContentConnector(
    { networkEnabled: true, apiToken: "synthetic-token" },
    async (_, init) => {
      if (init?.method === "POST") {
        posts++;
        runInput = JSON.parse(String(init.body));
        if (mode === "interrupt") throw Error("synthetic interrupted POST");
        return Response.json({
          data: {
            id: "fixtureRun",
            defaultDatasetId: "fixtureDataset",
            status: "RUNNING",
          },
        });
      }
      reads++;
      if (reads % 2)
        return Response.json({
          data: {
            id: "fixtureRun",
            defaultDatasetId: "fixtureDataset",
            status: "SUCCEEDED",
          },
        });
      if (mode === "pause") {
        await db.pool.query(
          "UPDATE collection_source SET state='paused' WHERE id=$1",
          [sourceId],
        );
        await db.pool.query(
          "UPDATE source_collection_job SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE collection_source_id=$1 AND status='running'",
          [sourceId],
        );
      }
      return Response.json([
        {
          type: "post",
          id: "root123",
          fullName: "t3_root123",
          title: "Native OR result",
          score: 5,
          numComments: 12,
          subreddit: "fixture",
          selftext: "Evidence",
          createdUtc: Date.now() / 1000 - 60,
        },
        {
          type: "comment",
          id: "19riqx8r047lt",
          fullName: "t1_19riqx8r047lt",
          parentId: "t3_root123",
          linkId: "t3_root123",
          body: "Useful comment",
          subreddit: "fixture",
          createdUtc: Date.now() / 1000 - 30,
        },
      ]);
    },
  );
  let safeRequests = 0;
  const safeProvider = new BlueskyAppViewContentConnector({
    networkEnabled: true,
    fetcher: async () => {
      safeRequests++;
      return new Response("rate limited", { status: 429 });
    },
  });
  const feedUrl = "https://fixture.example/atom";
  const listUrl = "https://fixture.example/releases";
  const jsonUrl = "https://fixture.example/api/releases";
  const published = new Date(Date.now() - 60000).toUTCString();
  let feedChecks = 0;
  let overflowingFeed = false;
  const feed = webSource("feed", { SOURCE_NETWORK_ENABLED: "true", FEED_ALLOWED_URLS: [feedUrl, listUrl, jsonUrl].join(",") }, async (url, _signal, requestHeaders) => {
    if (url.href === listUrl) return { status: 200, body: `<link rel="alternate" type="application/atom+xml" href="/atom">
      <article class="release"><h2><a href="/tool">Web result</a></h2><p>Summary</p><time datetime="2026-11-16T10:00:00Z"></time></article>` };
    if (url.href === jsonUrl) return { status: 200, body: JSON.stringify({ data: { releases: [
      { ref: { url: "/tool" }, title: "JSON result", description: "Summary" },
      { ref: { url: "/release" }, title: "开源算力工具", time: new Date(published).toISOString() },
    ] } }) };
    feedChecks++;
    if (!overflowingFeed && requestHeaders?.["If-None-Match"] === '"fixture"') return { status: 304, body: "" };
    return { status: 200, etag: '"fixture"', body: `<rss version="2.0"><channel><title>Fixture</title>
      <item><title>开源算力工具</title><link>https://fixture.example/release</link><pubDate>${published}</pubDate></item>
      ${overflowingFeed ? `<item><title>Another release</title><link>https://fixture.example/another</link><pubDate>${published}</pubDate></item>` : ""}
      </channel></rss>` };
  });
  const app = await buildApp({
    pool: db.pool,
    sessionSecret: "synthetic-secret-".repeat(3),
    origin,
    secureCookies: false,
    providers: [connector, safeProvider, feed],
  });
  await app.ready();
  t.after(() => app.close());
  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    headers: { origin },
    payload: { email: "owner@example.test", password: "fixture-password-123" },
  });
  const headers = {
    cookie: login.headers["set-cookie"]!.toString().split(";")[0],
    origin,
  };
  const create = async (label: string) => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/sources",
      headers,
      payload: {
        platform: "reddit",
        primaryProvider: "kaix",
        deliveryMode: "pull",
        label,
        target: { type: "search", query: label },
        contentKind: "post",
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    sourceId = response.json().source.id;
    return sourceId;
  };
  const enqueue = async (id: string) => {
    const result = await app.inject({
      method: "POST",
      url: `/v1/sources/${id}/collect`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: {
        from: new Date(Date.now() - 86400000).toISOString(),
        to: now,
        limit: 5,
        includeComments: true,
      },
    });
    assert.equal(result.statusCode, 200, result.body);
    return result.json().jobId as string;
  };
  const wake = () =>
    db.pool.query(
      "UPDATE source_collection_job SET next_run_at=NOW() WHERE status IN ('queued','retrying')",
    );
  const first = await create("OpenAI OR Anthropic"),
    jobId = await enqueue(first);
  // Rollout compatibility: an already-enqueued max_pages=1 job kept its inline Actor input.
  await db.pool.query("UPDATE source_collection_job SET max_pages=1 WHERE id=$1", [jobId]);
  const missingFallback = await app.inject({
    method: "POST", url: `/v1/sources/${first}/collect`,
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: { from: new Date(Date.now() - 86400000).toISOString(), to: now, limit: 5, useFallback: true },
  });
  assert.equal(missingFallback.statusCode, 422);
  assert.match(missingFallback.body, /No fallback provider configured/);
  await workOnce(db.pool, [connector]);
  assert.equal(posts, 0, "New paid providers start with disabled zero budgets");
  const { rows: [parked] } = await db.pool.query(
    "SELECT attempts,next_run_at::text FROM source_collection_job WHERE id=$1", [jobId],
  );
  assert.deepEqual(parked, { attempts: 0, next_run_at: "infinity" });
  await db.pool.query(
    "UPDATE source_provider_budget SET enabled=TRUE,daily_requests=5,monthly_requests=5,daily_resources=1000,monthly_resources=1000 WHERE provider='kaix'",
  );
  await wake();
  await workOnce(db.pool, [connector]);
  assert.equal(posts, 1);
  const running = (
    await db.pool.query("SELECT * FROM source_collection_job WHERE id=$1", [
      jobId,
    ])
  ).rows[0];
  assert.deepEqual(running.provider_state, {
    phase: "running",
    runId: "fixtureRun",
    datasetId: "fixtureDataset",
  });
  await wake();
  await Promise.all([
    workOnce(db.pool, [connector]),
    workOnce(db.pool, [connector]),
  ]);
  assert.equal(posts, 1, "Restart/polling never resubmits paid POST");
  assert.equal(
    (
      await db.pool.query(
        "SELECT status FROM source_collection_job WHERE id=$1",
        [jobId],
      )
    ).rows[0].status,
    "succeeded",
  );
  assert.equal(
    (
      await db.pool.query(
        "SELECT COUNT(*) FROM content_discovery WHERE collection_source_id=$1",
        [first],
      )
    ).rows[0].count,
    "2",
  );
  assert.equal(
    (
      await db.pool.query(
        "SELECT requests FROM source_provider_usage WHERE provider='kaix'",
      )
    ).rows[0].requests,
    1,
  );
  mode = "interrupt";
  const unknownSource = await create("Interrupted operation"),
    unknownJob = await enqueue(unknownSource);
  await workOnce(db.pool, [connector]);
  const unknown = (
    await db.pool.query("SELECT * FROM source_collection_job WHERE id=$1", [
      unknownJob,
    ])
  ).rows[0];
  assert.equal(unknown.provider_state.phase, "unknown");
  assert.equal(unknown.status, "failed");
  const before = posts;
  await workOnce(db.pool, [connector]);
  assert.equal(posts, before);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: `/v1/sources/${unknownSource}/collect`,
        headers: { ...headers, "idempotency-key": randomUUID() },
        payload: {
          from: new Date(Date.now() - 86400000).toISOString(),
          to: now,
          limit: 5,
        },
      })
    ).statusCode,
    409,
  );
  mode = "pause";
  const paused = await create("Paused operation"),
    pausedJob = await enqueue(paused);
  await workOnce(db.pool, [connector]);
  await wake();
  await workOnce(db.pool, [connector]);
  assert.equal(
    (
      await db.pool.query(
        "SELECT status FROM source_collection_job WHERE id=$1",
        [pausedJob],
      )
    ).rows[0].status,
    "cancelled",
  );
  assert.equal(
    (
      await db.pool.query(
        "SELECT COUNT(*) FROM content_discovery WHERE collection_source_id=$1",
        [paused],
      )
    ).rows[0].count,
    "0",
    "Revoked lease cannot commit returned dataset",
  );
  const crashed = await create("Crashed start"),
    crashedJob = await enqueue(crashed);
  await db.pool.query(
    "UPDATE source_collection_job SET status='running',lease_token=$2,lease_until=NOW()-interval '1 second',provider_state='{\"phase\":\"starting\"}' WHERE id=$1",
    [crashedJob, randomUUID()],
  );
  await workOnce(db.pool, [connector]);
  assert.equal(posts, before + 1);
  assert.equal(
    (
      await db.pool.query(
        "SELECT provider_state FROM source_collection_job WHERE id=$1",
        [crashedJob],
      )
    ).rows[0].provider_state.phase,
    "unknown",
  );
  const safeSource = await app.inject({
    method: "POST",
    url: "/v1/sources",
    headers,
    payload: {
      platform: "bluesky",
      primaryProvider: "bluesky_appview",
      deliveryMode: "pull",
      label: "Safe reads",
      contentKind: "post",
      target: { type: "account", account: "fixture.bsky.social" },
    },
  });
  assert.equal(safeSource.statusCode, 200, safeSource.body);
  const safeId = safeSource.json().source.id;
  const safeJob = await app.inject({
    method: "POST",
    url: `/v1/sources/${safeId}/collect`,
    headers: { ...headers, "idempotency-key": randomUUID() },
    payload: {
      from: new Date(Date.now() - 86400000).toISOString(),
      to: now,
      limit: 5,
    },
  });
  assert.equal(safeJob.statusCode, 200, safeJob.body);
  for (let i = 0; i < 2; i++) {
    await wake();
    await workOnce(db.pool, [safeProvider]);
  }
  assert.equal(safeRequests, 0);
  await db.pool.query(
    "UPDATE source_provider_budget SET enabled=TRUE,daily_requests=10,monthly_requests=10,daily_resources=100,monthly_resources=100 WHERE provider='bluesky_appview'",
  );
  for (let i = 0; i < 4; i++) {
    await wake();
    await workOnce(db.pool, [safeProvider]);
  }
  assert.equal(
    safeRequests,
    3,
    "Budget deferrals do not consume request attempts and safe transient reads stop at three",
  );
  const safeResult = (
    await db.pool.query(
      `SELECT j.status,j.page_request_attempts,cs.automatic_collection_blocked
       FROM source_collection_job j JOIN collection_source cs ON cs.id=j.collection_source_id WHERE j.id=$1`,
      [safeJob.json().jobId],
    )
  ).rows[0];
  assert.equal(safeResult.status, "failed");
  assert.equal(safeResult.page_request_attempts, 3);
  assert.equal(safeResult.automatic_collection_blocked, false);
  await t.test("project hydration queues the selected root and preserves the discovery watermark", async () => {
    const project = await app.inject({
      method: "POST", url: "/v1/projects", headers,
      payload: { name: "Hydration", sourceIds: [first], filter: { query: "Useful comment" } },
    });
    assert.equal(project.statusCode, 200, project.body);
    const scoped = await app.inject({ url: `/v1/content?projectId=${project.json().id}`, headers });
    assert.equal(scoped.statusCode, 200, scoped.body);
    assert.deepEqual(scoped.json().items.map((item: { externalId: string }) => item.externalId), ["t3_root123"]);
    const overview = (await app.inject({ url: `/v1/projects/${project.json().id}/overview`, headers })).json();
    assert.equal(overview.contentCount, 1);
    assert.equal(overview.matchedContentCount, 1);
    assert.deepEqual(overview.providers, ["kaix"]);
    const day = overview.facets.find((facet: { day: string | null }) => facet.day)?.day;
    assert.ok(day);
    assert.deepEqual(overview.dayPlatformFacets, [{ day, platform: "reddit", count: 1, matchedContentCount: 1 }]);
    assert.equal(overview.facets.find((facet: { kind: string }) => facet.kind === "comment")?.matchedContentCount, 1);
    for (const signal of ["discussion", "pain"]) {
      const filtered = await app.inject({ url: `/v1/content?sourceId=${first}&signal=${signal}`, headers });
      assert.equal(filtered.statusCode, 200, filtered.body);
      assert.deepEqual(filtered.json().items.map((item: { externalId: string }) => item.externalId), ["t3_root123"]);
    }
    const hydrationKey = randomUUID();
    const hydrate = (idempotencyKey = randomUUID()) => app.inject({
      method: "POST", url: `/v1/projects/${project.json().id}/hydrate`,
      headers: { ...headers, "idempotency-key": idempotencyKey },
      payload: { contentIds: [scoped.json().items[0].id], maxCommentsPerPost: 4 },
    });
    const response = await hydrate(hydrationKey);
    assert.equal(response.statusCode, 200, response.body);
    const replay = await hydrate(hydrationKey);
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json().jobIds, response.json().jobIds);
    const machine = await app.inject({ method: "POST", url: "/v1/access/keys", headers,
      payload: { label: "Hydration replay", scopes: ["read", "collect"], allowedSourceIds: [first], expiresInDays: 7 } });
    assert.equal(machine.statusCode, 200, machine.body);
    const crossClient = await app.inject({ method: "POST", url: `/v1/projects/${project.json().id}/hydrate`,
      headers: { authorization: `Bearer ${machine.json().token}`, "idempotency-key": hydrationKey },
      payload: { contentIds: [scoped.json().items[0].id], maxCommentsPerPost: 4 } });
    assert.equal(crossClient.statusCode, 409, crossClient.body);
    const second = await hydrate();
    assert.equal(second.statusCode, 200, second.body);
    mode = "success";
    const beforeHydrate = (await db.pool.query("SELECT incremental_to FROM collection_source WHERE id=$1", [first])).rows[0];
    await workOnce(db.pool, [connector]);
    assert.equal(await workOnce(db.pool, [connector]), false, "Waiting for the first run holds its source");
    await wake();
    await workOnce(db.pool, [connector]);
    assert.equal(runInput.mode, "post");
    assert.equal(runInput.commentSort, "top");
    const job = await app.inject({ url: `/v1/source-jobs/${response.json().jobIds[0]}`, headers });
    assert.equal(job.json().job.status, "succeeded");
    const afterHydrate = (await db.pool.query("SELECT incremental_to FROM collection_source WHERE id=$1", [first])).rows[0];
    assert.deepEqual(afterHydrate, beforeHydrate);
  });

  await t.test("the background worker schedules an approved feed and resumes its checkpoint after restarting", async () => {
    const response = await app.inject({
      method: "POST", url: "/v1/sources", headers,
      payload: {
        platform: "web", primaryProvider: "feed", deliveryMode: "pull",
        label: "Fixture feed", target: { type: "feed", url: feedUrl },
        contentKind: "article", schedule: { enabled: true, cadenceSeconds: 120 },
      },
    });
    assert.equal(response.statusCode, 200, response.body);
    const { id } = response.json().source;
    await scheduleDueSourcesOnce(db.pool, [feed]);
    assert.equal(feedChecks, 0);
    assert.equal((await db.pool.query("SELECT 1 FROM source_collection_job WHERE collection_source_id=$1", [id])).rowCount, 0);
    await db.pool.query(`
      UPDATE source_provider_budget SET enabled=true,daily_requests=4,monthly_requests=4,daily_resources=100,monthly_resources=100
      WHERE provider='feed'`);
    const runUntil = async (runs: number) => {
      const worker = startWorker(db.pool, [feed]);
      try {
        for (let attempt = 0; attempt < 50; attempt++) {
          const { rows: [result] } = await db.pool.query(`
            SELECT count(*)::int AS count FROM source_collection_job
            WHERE collection_source_id=$1 AND purpose='scheduled' AND status='succeeded'`, [id]);
          if (result.count === runs) return;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.fail("Scheduled collection did not complete");
      } finally {
        await worker.stop();
      }
    };
    await runUntil(1);
    const latest = await app.inject({ url: "/v1/content/feed?query=%E7%AE%97%E5%8A%9B&searchScope=title", headers });
    assert.equal(latest.statusCode, 200, latest.body);
    assert.deepEqual(latest.json().items.map(({ title }: { title: string }) => title), ["开源算力工具"]);
    await db.pool.query("UPDATE collection_source SET next_due_at=now() WHERE id=$1", [id]);
    await runUntil(2);
    assert.equal(feedChecks, 2);
    const { rows: [last] } = await db.pool.query(`
      SELECT status,records_inserted,request_count FROM source_collection_job
      WHERE collection_source_id=$1 ORDER BY created_at DESC LIMIT 1`, [id]);
    assert.deepEqual(last, { status: "succeeded", records_inserted: 0, request_count: 1 });
    overflowingFeed = true;
    try {
      await db.pool.query(`UPDATE collection_source SET next_due_at=now(),
        schedule=schedule||'{"cadenceSeconds":7200,"intervalSeconds":7200,"pageSize":1}'::jsonb WHERE id=$1`, [id]);
      await runUntil(3);
      const { rows: [truncated] } = await db.pool.query(`SELECT job.exhausted,cs.schedule->>'intervalSeconds' AS interval
        FROM source_collection_job job JOIN collection_source cs ON cs.id=job.collection_source_id
        WHERE job.collection_source_id=$1 ORDER BY job.created_at DESC LIMIT 1`, [id]);
      assert.deepEqual(truncated, { exhausted: false, interval: "7200" });
    } finally {
      overflowingFeed = false;
    }
    const { rows: [heartbeat] } = await db.pool.query("SELECT state FROM source_worker_heartbeat WHERE id='unified-collection'");
    assert.equal(heartbeat?.state, "stopped");
  });
  await t.test("source preview shares creation validation, parses public lists and never starts paid runs", async () => {
    const snapshot = async () => (await db.pool.query(`SELECT
      (SELECT count(*) FROM collection_source) AS sources, (SELECT count(*) FROM source_collection_job) AS jobs,
      (SELECT count(*) FROM content) AS content, (SELECT count(*) FROM source_provider_usage) AS usage`)).rows[0];
    const before = await snapshot();
    const paidStarts = posts;
    const web = { platform: "web", primaryProvider: "feed", contentKind: "article", deliveryMode: "pull", label: "Fixture list" };
    const html = { ...web, target: { type: "feed", url: listUrl, list: {
      format: "web_list", items: "article.release", title: "h2 > a", link: "a", summary: "p", publishedAt: "time",
    } } };
    const json = { ...web, target: { type: "feed", url: jsonUrl, list: {
      format: "json_list", items: "data.releases", title: "title", link: "ref.url", summary: "description", publishedAt: "time",
    } } };
    const preview = (payload: object) => app.inject({ method: "POST", url: "/v1/sources/preview", headers, payload });
    const result = await preview(html);
    assert.equal(result.statusCode, 200, result.body);
    assert.deepEqual(result.json().items, [{
      url: "https://fixture.example/tool", title: "Web result", summary: "Summary", publishedAt: "2026-11-16T10:00:00.000Z",
    }]);
    assert.deepEqual(result.json().feeds, [feedUrl]);
    const parsed = await preview(json);
    assert.equal(parsed.statusCode, 200, parsed.body);
    assert.deepEqual(parsed.json().items[1], { url: "https://fixture.example/tool", title: "JSON result", summary: "Summary", publishedAt: null });
    assert.equal((await preview({ ...json, target: { ...json.target, list: { ...json.target.list, items: "missing" } } })).statusCode, 422);
    assert.equal((await preview({ ...html, target: { ...html.target, url: "https://unapproved.example/releases" } })).statusCode, 422);
    const paid = await preview({ platform: "reddit", primaryProvider: "kaix", contentKind: "post", deliveryMode: "pull",
      label: "Paid dry run", target: { type: "search", query: "Fixture" } });
    assert.equal(paid.statusCode, 200, paid.body);
    assert.equal(paid.json().mode, "validated");
    assert.equal(posts, paidStarts);
    assert.deepEqual(await snapshot(), before);
    const saved = await app.inject({ method: "POST", url: "/v1/sources", headers, payload: json });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(saved.json().source.target, parsed.json().target);
    const id = saved.json().source.id;
    const job = await app.inject({ method: "POST", url: `/v1/sources/${id}/collect`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: { from: new Date(Date.now() - 86400000).toISOString(), to: new Date().toISOString(), limit: 2 },
    });
    assert.equal(job.statusCode, 200, job.body);
    assert.equal(await workOnce(db.pool, [connector, safeProvider, feed]), true);
    const stored = await app.inject({ url: `/v1/content?sourceId=${id}`, headers });
    assert.equal(stored.statusCode, 200, stored.body);
    assert.deepEqual(stored.json().items.map(({ title }: { title: string }) => title), ["开源算力工具", "JSON result"]);
  });

  await t.test("tracks source metadata, HTTP ETag/health/duration, OPML/JSON import, and enforces rate limit before DB auth", async () => {
    const opml = `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><body>
      <outline text="ai-firsthand" title="ai-firsthand">
        <outline type="rss" text="Imported Feed" xmlUrl="https://fixture.example/atom" />
        <outline type="rss" text="New List Feed" xmlUrl="https://fixture.example/releases" />
        <outline type="rss" text="Blocked Local" xmlUrl="http://127.0.0.1/bad" />
      </outline>
    </body></opml>`;
    const imp = await app.inject({
      method: "POST", url: "/v1/sources/import", headers,
      payload: { format: "opml", opml, defaults: { tier: "T1", locale: "en", fetchPolicy: { maxItems: 50 } } },
    });
    assert.equal(imp.statusCode, 200, imp.body);
    assert.equal(imp.json().created, 1);
    assert.equal(imp.json().skipped, 1);
    assert.equal(imp.json().errors.length, 1);

    const sourcesRes = await app.inject({ url: "/v1/sources?sourceGroup=ai-firsthand", headers });
    assert.equal(sourcesRes.statusCode, 200, sourcesRes.body);
    const imported = sourcesRes.json().sources.find((s: { label: string }) => s.label === "New List Feed");
    assert.ok(imported);
    assert.equal(imported.locale, "en");
    assert.equal(imported.fetchPolicy.maxItems, 50);

    const jobStats = await db.pool.query(
      "SELECT max(request_duration_ms) AS max_ms FROM source_collection_job WHERE provider='feed' AND status='succeeded'",
    );
    assert.ok(Number(jobStats.rows[0].max_ms) > 0);
    const cachedSources = await db.pool.query(
      "SELECT http_etag, health FROM collection_source WHERE primary_provider='feed' AND http_etag IS NOT NULL",
    );
    assert.ok(cachedSources.rowCount && cachedSources.rowCount >= 1);
    assert.equal(cachedSources.rows[0].health.lastStatus, "succeeded");
    assert.ok(cachedSources.rows[0].health.totalRuns >= 1);

    // Rate limit runs before preParsing DB actor lookup
    let dbQueries = 0;
    const origQuery = db.pool.query.bind(db.pool);
    const spyPool = Object.create(db.pool);
    spyPool.query = (...args: unknown[]) => { dbQueries++; return origQuery(...(args as [string])); };
    const limited = await buildApp({
      pool: spyPool, sessionSecret: "rate-limit-secret-".repeat(3), origin, secureCookies: false, rateLimitMax: 1,
    });
    await limited.ready();
    try {
      const badBearer = { authorization: "Bearer " + "a".repeat(43) };
      assert.equal((await limited.inject({ url: "/v1/sources", headers: badBearer })).statusCode, 401);
      const afterFirst = dbQueries;
      assert.equal(afterFirst, 1);
      assert.equal((await limited.inject({ url: "/v1/sources", headers: badBearer })).statusCode, 429);
      assert.equal(dbQueries, afterFirst, "429 must not hit DB auth lookup");
    } finally {
      await limited.close();
    }
  });
  await t.test("job retention keeps keyed and unresolved receipts while removing old unkeyed jobs", async () => {
    const { rows } = await db.pool.query(`
      INSERT INTO source_collection_job(
        id,collection_source_id,status,purpose,operation,provider,from_at,to_at,page_size,max_pages,
        next_run_at,created_at,finished_at,request_key,ingest_key,provider_state
      )
      SELECT gen_random_uuid(),cs.id,'succeeded',CASE WHEN kind='push' THEN 'ingest' ELSE 'manual' END,
        CASE WHEN kind='push' THEN 'ingest' ELSE 'radar' END,'feed',now()-interval '2 days',now()-interval '1 day',1,1,
        now(),now()-age,now()-age,request_key,ingest_key,provider_state
      FROM collection_source cs CROSS JOIN (
        VALUES ('expired', interval '20 days', NULL, NULL, '{}'::jsonb),
               ('manual', interval '20 days', 'old-manual-key', NULL, '{}'::jsonb),
               ('push', interval '20 days', NULL, 'old-ingest-key', '{}'::jsonb),
               ('unknown', interval '20 days', NULL, NULL, '{"phase":"unknown"}'::jsonb)
        UNION ALL
        SELECT 'new',make_interval(hours=>age),NULL,NULL,'{}'::jsonb FROM generate_series(1,5) age
      ) jobs(kind,age,request_key,ingest_key,provider_state)
      WHERE cs.label='Fixture feed'
      RETURNING id,request_key,ingest_key,provider_state->>'phase' AS phase,finished_at < now()-interval '14 days' AS aged`);
    const aged = rows.filter(row => row.aged);
    assert.equal(aged.length, 4);
    const expired = aged.find(row => !row.request_key && !row.ingest_key && !row.phase);
    const worker = startWorker(db.pool, []);
    try {
      for (let attempt = 0; attempt < 40; attempt++) {
        const kept = await db.pool.query("SELECT id FROM source_collection_job WHERE id=ANY($1::uuid[])", [aged.map(row => row.id)]);
        const keptIds = new Set(kept.rows.map(row => row.id));
        if (!keptIds.has(expired.id)) {
          assert.deepEqual(keptIds, new Set(aged.filter(row => row !== expired).map(row => row.id)));
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.fail("Worker did not remove the eligible expired job");
    } finally {
      await worker.stop();
    }
  });

});

test("PG16 Apify slot accounting, authorized capacity retries, and read-only recovery", async (t) => {
  const previous = process.env.KAIX_MAX_CONCURRENT_JOBS;
  process.env.KAIX_MAX_CONCURRENT_JOBS = "2";
  t.after(() => {
    if (previous === undefined) delete process.env.KAIX_MAX_CONCURRENT_JOBS;
    else process.env.KAIX_MAX_CONCURRENT_JOBS = previous;
  });
  const db = await testDatabase();
  t.after(db.close);
  await bootstrapOwner(db.pool, "fixture-password-123", "owner@example.test");
  await db.pool.query(`UPDATE source_provider_budget SET enabled=true, daily_requests=40, monthly_requests=40,
    daily_resources=2000, monthly_resources=2000, minimum_interval_ms=0 WHERE provider IN ('kaix','feed')`);

  const starts: string[] = [];
  const polls: string[] = [];
  let startFailure: (() => Response) | undefined;
  let failReads = false;
  const receipt = (id: string, status: string) => Response.json({ data: { id, status, defaultDatasetId: "fixtureDataset" } });
  const kaix = new KaixContentConnector({ networkEnabled: true, apiToken: "synthetic-token" }, async (input, init) => {
    if (init?.method === "POST") {
      starts.push(JSON.parse(String(init.body)).keyword);
      return startFailure?.() ?? receipt(`run${starts.length}`, "RUNNING");
    }
    const path = new URL(String(input)).pathname;
    if (path.startsWith("/v2/actor-runs/")) {
      const id = path.split("/").at(-1)!;
      polls.push(id);
      return receipt(id, "SUCCEEDED");
    }
    return failReads ? new Response(null, { status: 502 }) : Response.json([]);
  });
  const feedUrl = "https://pool.example.test/rss";
  let feedChecks = 0;
  const feed = webSource("feed", { SOURCE_NETWORK_ENABLED: "true", FEED_ALLOWED_URLS: feedUrl }, async () => {
    feedChecks++;
    return { status: 200, body: `<rss version="2.0"><channel><title>Pool feed</title>
      <item><title>Independent feed</title><link>https://pool.example.test/item</link>
      <pubDate>${new Date(Date.now() - 60_000).toUTCString()}</pubDate></item></channel></rss>` };
  });
  const providers = [kaix, feed];
  const app = await buildApp({ pool: db.pool, sessionSecret: "pool-fixture-".repeat(3), origin, secureCookies: false, providers });
  t.after(() => app.close());
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", headers: { origin },
    payload: { email: "owner@example.test", password: "fixture-password-123" } });
  assert.equal(login.statusCode, 200, login.body);
  const headers = { cookie: login.headers["set-cookie"]!.toString().split(";")[0], origin };
  const createSource = async (label: string, { scheduled = false, isFeed = false } = {}) => {
    const response = await app.inject({ method: "POST", url: "/v1/sources", headers, payload: {
      label, deliveryMode: "pull",
      ...(isFeed ? { platform: "web", primaryProvider: "feed", contentKind: "article", target: { type: "feed", url: feedUrl } }
        : { platform: "reddit", primaryProvider: "kaix", contentKind: "post", target: { type: "search", query: label } }),
      ...(scheduled ? { schedule: { enabled: true, cadenceSeconds: 3600, pageSize: 5 } } : {}),
    } });
    assert.equal(response.statusCode, 200, response.body);
    return response.json().source.id as string;
  };
  const enqueue = async (sourceId: string) => {
    const result = await app.inject({ method: "POST", url: `/v1/sources/${sourceId}/collect`,
      headers: { ...headers, "idempotency-key": randomUUID() }, payload: {
        from: new Date(Date.now() - 3_600_000).toISOString(), to: new Date().toISOString(), limit: 5,
      } });
    assert.equal(result.statusCode, 200, result.body);
    return result.json().jobId as string;
  };
  const job = async (id: string) => (await db.pool.query(`SELECT j.*,cs.automatic_collection_blocked,
    EXTRACT(EPOCH FROM next_run_at - NOW())::float8 AS wait_seconds
    FROM source_collection_job j JOIN collection_source cs ON cs.id=j.collection_source_id WHERE j.id=$1`, [id])).rows[0];
  const wake = (id: string) => db.pool.query("UPDATE source_collection_job SET next_run_at=NOW() WHERE id=$1", [id]);
  const tick = () => workOnce(db.pool, providers, undefined, undefined, { authorizeScheduledSourceDispatch });

  await t.test("three Kaix jobs and a feed compete; overdue remote runs occupy the shared pool until GET reconciliation", async () => {
    const kaixIds = [];
    for (let i = 0; i < 3; i++) kaixIds.push(await enqueue(await createSource(`Slot ${i}`)));
    const feedId = await enqueue(await createSource("Independent feed", { isFeed: true }));
    await Promise.all(Array.from({ length: 4 }, tick));
    assert.equal(starts.length, 2);
    assert.equal(feedChecks, 1);
    assert.equal((await job(feedId)).status, "succeeded");
    const jobs = await Promise.all(kaixIds.map(job));
    const occupied = jobs.filter((row) => row.provider_run_id);
    const waiting = jobs.find((row) => !row.provider_run_id);
    assert.equal(occupied.length, 2);
    assert.equal(waiting.status, "queued");
    assert.equal(waiting.request_count, 0);
    const [expired, peer] = occupied;
    await db.pool.query(`UPDATE source_collection_job SET status='running',lease_token=$2,
      lease_until=NOW()-interval '1 second', next_run_at=NOW()+interval '1 day' WHERE id=$1`, [expired.id, randomUUID()]);
    // An already-paid peer from the other actor consumes a slot in the same account.
    await db.pool.query("UPDATE source_collection_job SET provider='red_crawler',next_run_at=NOW()+interval '1 day' WHERE id=$1", [peer.id]);
    assert.equal(await tick(), false);
    assert.equal(starts.length, 2);
    await db.pool.query("UPDATE collection_source SET state='paused' WHERE id=$1", [expired.collection_source_id]);
    await wake(expired.id);
    assert.equal(await tick(), true);
    assert.deepEqual(polls, [expired.provider_run_id]);
    assert.equal((await job(expired.id)).status, "succeeded");
    assert.equal(starts.length, 2, "paused source only reconciles its existing run");
    assert.equal(await tick(), true);
    assert.equal(starts.length, 3);
    await db.pool.query("UPDATE source_collection_job SET provider='kaix' WHERE id=$1", [peer.id]);
    for (const id of [peer.id, waiting.id]) {
      await wake(id);
      assert.equal(await tick(), true);
      assert.equal((await job(id)).status, "succeeded");
    }
  });

  await t.test("scheduled capacity 402 backs off, charges the monitor once, and stops after six POSTs", async () => {
    const sourceId = await createSource("Scheduled capacity", { scheduled: true });
    const monitorId = randomUUID();
    await db.pool.query(`INSERT INTO intel_monitor(id,owner_user_id,kind,name,next_due_at)
      SELECT $1,id,'keyword','Capacity fixture',NOW()-interval '1 minute' FROM app_user WHERE email='owner@example.test'`, [monitorId]);
    await db.pool.query("INSERT INTO intel_monitor_source(monitor_id,collection_source_id) VALUES ($1,$2)", [monitorId, sourceId]);
    assert.equal((await scheduleDueSourcesOnce(db.pool, [kaix])).enqueuedCount, 1);
    const { rows: [{ id }] } = await db.pool.query("SELECT id FROM source_collection_job WHERE collection_source_id=$1", [sourceId]);
    startFailure = () => Response.json({ error: { type: "actor-memory-limit-exceeded" } }, { status: 402 });
    const before = starts.length;
    for (let attempt = 1; attempt <= 6; attempt++) {
      assert.equal(await tick(), true);
      const row = await job(id);
      assert.equal(row.request_count, attempt);
      assert.equal(row.page_request_attempts, attempt);
      assert.equal(row.automatic_collection_blocked, false);
      assert.equal(row.status, attempt < 6 ? "retrying" : "failed");
      if (attempt < 6) {
        assert.deepEqual(row.provider_state, { monitorAuthorized: true });
        const base = Math.min(175, 25 * 2 ** (attempt - 1));
        assert.ok(row.wait_seconds > base - 5 && row.wait_seconds <= base + 5, `unexpected backoff: ${row.wait_seconds}`);
        await wake(id);
      }
    }
    assert.equal(await tick(), false);
    assert.equal(starts.length - before, 6);
    const { rows: [monitor] } = await db.pool.query(`SELECT u.requests,m.next_due_at>NOW() AS advanced
      FROM intel_monitor m JOIN intel_monitor_usage u ON u.monitor_id=m.id WHERE m.id=$1`, [monitorId]);
    assert.deepEqual(monitor, { requests: 1, advanced: true });
  });

  await t.test("ordinary 402 and gateway failures never replay, and a broken 402 opens the source circuit", async () => {
    for (const [label, expected, response] of [
      ["Billing 402", "failed", () => Response.json({ error: { type: "monthly-usage-exceeded" } }, { status: 402 })],
      ["Opaque 402", "unknown", () => Response.json({}, { status: 402 })],
      ["Gateway 502", "unknown", () => new Response(null, { status: 502 })],
      ["Broken 402", "unknown", () => new Response(new ReadableStream({ start(controller) { controller.error(Error("fixture")); } }), { status: 402 })],
    ] as const) {
      const id = await enqueue(await createSource(label));
      startFailure = response;
      const before = starts.length;
      assert.equal(await tick(), true);
      const row = await job(id);
      assert.equal(row.status, "failed");
      assert.equal(row.provider_state.phase, expected);
      assert.equal(row.automatic_collection_blocked, expected === "unknown");
      assert.equal(await tick(), false);
      assert.equal(starts.length - before, 1);
    }
  });

  await t.test("read retries survive state saves and terminate while retaining the paid run ID", async () => {
    startFailure = undefined;
    failReads = true;
    const id = await enqueue(await createSource("Bounded GET retries"));
    const before = starts.length;
    assert.equal(await tick(), true);
    const runId = (await job(id)).provider_run_id;
    assert.ok(runId);
    for (let retry = 1; retry <= 13; retry++) {
      await wake(id);
      assert.equal(await tick(), true);
      const row = await job(id);
      assert.equal(row.status, retry <= 12 ? "retrying" : "failed");
      assert.deepEqual(row.provider_state, { phase: "reading", runId, datasetId: "fixtureDataset", readRetries: Math.min(retry, 12) });
      assert.equal(row.provider_run_id, runId);
    }
    assert.equal(await tick(), false);
    assert.equal(starts.length - before, 1);
  });
});
