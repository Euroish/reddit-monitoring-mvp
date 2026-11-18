import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { startWorker, workOnce } from "../../src/modules/collection/worker";
import { KaixContentConnector } from "../../src/connectors/reddit/kaix-content.connector";
import { BlueskyAppViewContentConnector } from "../../src/connectors/bluesky/bluesky-appview-content.connector";
import { scheduleDueSourcesOnce } from "../../src/modules/collection/schedule";
import { webSource } from "../../src/connectors/web/sources";
import { testDatabase } from "../helpers/database";

const origin = "http://workbench.test";
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
  let feedChecks = 0;
  const feed = webSource("feed", { SOURCE_NETWORK_ENABLED: "true", FEED_ALLOWED_URLS: [feedUrl, listUrl, jsonUrl].join(",") }, async (url, _signal, requestHeaders) => {
    if (url.href === listUrl) return { status: 200, body: `<link rel="alternate" type="application/atom+xml" href="/atom">
      <article class="release"><h2><a href="/tool">Web result</a></h2><p>Summary</p><time datetime="2026-11-16T10:00:00Z"></time></article>` };
    if (url.href === jsonUrl) return { status: 200, body: JSON.stringify({ data: { releases: [
      { ref: { url: "/tool" }, title: "JSON result", description: "Summary" },
    ] } }) };
    feedChecks++;
    if (requestHeaders?.["If-None-Match"] === '"fixture"') return { status: 304, body: "" };
    const published = new Date(Date.now() - 60000).toUTCString();
    return { status: 200, etag: '"fixture"', body: `<rss version="2.0"><channel><title>Fixture</title>
      <item><title>开源算力工具</title><link>https://fixture.example/release</link><pubDate>${published}</pubDate></item>
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
    assert.equal(overview.facets.find((facet: { kind: string }) => facet.kind === "comment")?.matchedContentCount, 1);
    for (const signal of ["discussion", "pain"]) {
      const filtered = await app.inject({ url: `/v1/content?sourceId=${first}&signal=${signal}`, headers });
      assert.equal(filtered.statusCode, 200, filtered.body);
      assert.deepEqual(filtered.json().items.map((item: { externalId: string }) => item.externalId), ["t3_root123"]);
    }
    const hydrate = () => app.inject({
      method: "POST", url: `/v1/projects/${project.json().id}/hydrate`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: { contentIds: [scoped.json().items[0].id], maxCommentsPerPost: 4 },
    });
    const response = await hydrate();
    assert.equal(response.statusCode, 200, response.body);
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
      format: "json_list", items: "data.releases", title: "title", link: "ref.url", summary: "description",
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
    assert.deepEqual(parsed.json().items, [{ url: "https://fixture.example/tool", title: "JSON result", summary: "Summary", publishedAt: null }]);
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
      payload: { from: "2026-11-16T00:00:00Z", to: "2026-11-17T00:00:00Z", limit: 2 },
    });
    assert.equal(job.statusCode, 200, job.body);
    assert.equal(await workOnce(db.pool, [connector, safeProvider, feed]), true);
    const stored = await app.inject({ url: `/v1/content?sourceId=${id}`, headers });
    assert.equal(stored.statusCode, 200, stored.body);
    assert.equal(stored.json().items[0]?.title, "JSON result");
  });
});
