import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/app";
import { bootstrapOwner } from "../../src/modules/access/sql";
import { workOnce } from "../../src/modules/collection/worker";
import { KaixContentConnector } from "../../src/connectors/reddit/kaix-content.connector";
import { BlueskyAppViewContentConnector } from "../../src/connectors/bluesky/bluesky-appview-content.connector";
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
  const app = await buildApp({
    pool: db.pool,
    sessionSecret: "synthetic-secret-".repeat(3),
    origin,
    secureCookies: false,
    providers: [connector, safeProvider],
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
  await workOnce(db.pool, [connector]);
  assert.equal(posts, 0, "New paid providers start with disabled zero budgets");
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
      "SELECT status,page_request_attempts FROM source_collection_job WHERE id=$1",
      [safeJob.json().jobId],
    )
  ).rows[0];
  assert.equal(safeResult.status, "failed");
  assert.equal(safeResult.page_request_attempts, 3);
  await t.test("project hydration queues the selected root and preserves the discovery watermark", async () => {
    const project = await app.inject({
      method: "POST", url: "/v1/projects", headers,
      payload: { name: "Hydration", sourceIds: [first], filter: { query: "Useful comment" } },
    });
    assert.equal(project.statusCode, 200, project.body);
    const scoped = await app.inject({ url: `/v1/content?projectId=${project.json().id}`, headers });
    assert.equal(scoped.statusCode, 200, scoped.body);
    assert.deepEqual(scoped.json().items.map((item: { externalId: string }) => item.externalId), ["t3_root123"]);
    for (const signal of ["discussion", "pain"]) {
      const filtered = await app.inject({ url: `/v1/content?sourceId=${first}&signal=${signal}`, headers });
      assert.equal(filtered.statusCode, 200, filtered.body);
      assert.deepEqual(filtered.json().items.map((item: { externalId: string }) => item.externalId), ["t3_root123"]);
    }
    const response = await app.inject({
      method: "POST", url: `/v1/projects/${project.json().id}/hydrate`,
      headers: { ...headers, "idempotency-key": randomUUID() },
      payload: { contentIds: [scoped.json().items[0].id], maxCommentsPerPost: 4 },
    });
    assert.equal(response.statusCode, 200, response.body);
    mode = "success";
    const beforeHydrate = (await db.pool.query("SELECT incremental_to FROM collection_source WHERE id=$1", [first])).rows[0];
    await workOnce(db.pool, [connector]);
    await wake();
    await workOnce(db.pool, [connector]);
    assert.equal(runInput.mode, "post");
    assert.equal(runInput.commentSort, "top");
    const job = await app.inject({ url: `/v1/source-jobs/${response.json().jobIds[0]}`, headers });
    assert.equal(job.json().job.status, "succeeded");
    const afterHydrate = (await db.pool.query("SELECT incremental_to FROM collection_source WHERE id=$1", [first])).rows[0];
    assert.deepEqual(afterHydrate, beforeHydrate);
  });

});
