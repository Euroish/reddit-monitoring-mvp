import assert from "node:assert/strict";
import test from "node:test";
import { createApiServer } from "../../apps/api/src/create-api-server";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import {
  createApiTestRepositories,
  postJson,
  startServer,
  stopServer,
} from "./api-server.helpers";

test("api server run trigger passes crawlMode to connector factory", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const observed: Array<{ mode: string; crawlMode: string | undefined }> = [];
  const repos = createApiTestRepositories();
  const server = createApiServer({
    repositories: repos,
    createConnector: (mode, crawlMode) => {
      observed.push({ mode, crawlMode });
      return new RedditMockConnector();
    },
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const runResult = await postJson<{
      ok: boolean;
      mode: string;
      crawlMode: string;
    }>(`${baseUrl}/v1/runs/reddit-phase1`, {
      mode: "mock",
      crawlMode: "backfill",
      subreddit: "datascience",
      async: false,
    });
    assert.equal(runResult.status, 200);
    assert.equal(runResult.body.ok, true);
    assert.equal(runResult.body.mode, "mock");
    assert.equal(runResult.body.crawlMode, "backfill");
    assert.deepEqual(observed, [{ mode: "mock", crawlMode: "backfill" }]);
  } finally {
    await stopServer(server);
  }
});

test("api server rejects unsupported run mode", async () => {
  const repos = createApiTestRepositories();
  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
  });

  const baseUrl = await startServer(server);
  try {
    const result = await postJson<{ ok: boolean; error: string; errorCode: string; requestId: string }>(
      `${baseUrl}/v1/runs/reddit-phase1`,
      { mode: "invalid-mode" },
    );
    assert.equal(result.status, 400);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.error, "mode must be live or mock");
    assert.equal(result.body.errorCode, "invalid_run_mode");
    assert.equal(result.body.requestId, result.requestId);
  } finally {
    await stopServer(server);
  }
});

test("api server accepts async run trigger by default", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const connectorCalls: Array<{ mode: string; crawlMode: string | undefined }> = [];
  const server = createApiServer({
    repositories: repos,
    createConnector: (mode, crawlMode) => {
      connectorCalls.push({ mode, crawlMode });
      return new RedditMockConnector();
    },
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    await postJson(`${baseUrl}/v1/targets/subreddit`, { subreddit: "datascience" });
    const runResult = await postJson<{
      ok: boolean;
      requestId: string;
      mode: string;
      processedCanonicalNames: string[];
      requestedCanonicalNames: string[];
    }>(`${baseUrl}/v1/runs/reddit-phase1`, {
      mode: "mock",
      subreddit: "datascience",
    });

    assert.equal(runResult.status, 202);
    assert.equal(runResult.body.ok, true);
    assert.deepEqual(runResult.body.processedCanonicalNames, []);
    assert.deepEqual(runResult.body.requestedCanonicalNames, ["r/datascience"]);
    assert.equal(runResult.body.requestId, runResult.requestId);
    assert.deepEqual(connectorCalls, []);
    assert.equal(repos.rawEventRepository.all().length, 0);
    assert.equal(repos.collectionJobRepository.all().length, 2);
    assert.deepEqual(
      repos.collectionJobRepository.all().map((job) => job.jobType).sort(),
      ["collect_subreddit_about", "collect_subreddit_new_posts"],
    );
  } finally {
    await stopServer(server);
  }
});
