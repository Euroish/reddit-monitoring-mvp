import assert from "node:assert/strict";
import test from "node:test";
import { createApiServer } from "../../apps/api/src/create-api-server";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  createApiTestRepositories,
  getJson,
  postJson,
  startServer,
  stopServer,
} from "./api-server.helpers";

test("api server can seed target, run phase1 and read trends", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const seedResult = await postJson<{ ok: boolean; requestId: string; canonicalName: string }>(
      `${baseUrl}/v1/targets/subreddit`,
      { subreddit: "DataScience" },
    );
    assert.equal(seedResult.status, 200);
    assert.equal(seedResult.body.ok, true);
    assert.equal(seedResult.body.canonicalName, "r/datascience");
    assert.equal(typeof seedResult.body.requestId, "string");
    assert.equal(seedResult.requestId, seedResult.body.requestId);

    const runResult = await postJson<{
      ok: boolean;
      requestId: string;
      mode: string;
      processedCanonicalNames: string[];
    }>(`${baseUrl}/v1/runs/reddit-phase1`, {
      mode: "mock",
      subreddit: "datascience",
      async: false,
    });
    assert.equal(runResult.status, 200);
    assert.equal(runResult.body.ok, true);
    assert.equal(runResult.body.mode, "mock");
    assert.deepEqual(runResult.body.processedCanonicalNames, ["r/datascience"]);
    assert.equal(runResult.requestId, runResult.body.requestId);

    const trendResult = await getJson<{
      ok: boolean;
      requestId: string;
      canonicalName: string;
      summary: { latestTrendDirection: string };
      topMovers: unknown[];
      recentAnomalies: unknown[];
      points: unknown[];
      recentPosts: unknown[];
    }>(
      `${baseUrl}/v1/trends/subreddit/datascience?from=2026-04-10T10:00:00.000Z&to=2026-04-10T12:15:00.000Z`,
    );
    assert.equal(trendResult.status, 200);
    assert.equal(trendResult.body.ok, true);
    assert.equal(trendResult.body.canonicalName, "r/datascience");
    assert.equal(trendResult.requestId, trendResult.body.requestId);
    assert.equal(trendResult.body.points.length > 0, true);
    assert.equal(trendResult.body.recentPosts.length > 0, true);
    assert.equal(
      ["rising", "flat", "falling", "unknown"].includes(
        trendResult.body.summary.latestTrendDirection,
      ),
      true,
    );
    assert.equal(Array.isArray(trendResult.body.topMovers), true);
    assert.equal(Array.isArray(trendResult.body.recentAnomalies), true);
  } finally {
    await stopServer(server);
  }
});

test("api server daily insights prefers materialized keyword rows when available", async () => {
  const fixedNow = "2026-04-12T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetId = stableUuidFromString("reddit:target:r/datascience");

  await repos.monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/datascience",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });

  await repos.subredditTrendPointRepository.upsertMany([
    {
      targetId,
      windowStart: "2026-04-10T10:00:00.000Z",
      windowEnd: "2026-04-10T10:15:00.000Z",
      newPosts: 10,
      commentSum: 20,
      deltaNewPostsVsPrevWindow: 0,
      deltaActiveUsersVsPrevWindow: 0,
      trendScore: 0.1,
    },
  ]);

  await repos.subredditDailyFactRepository.upsertMany([
    {
      targetId,
      day: "2026-04-10",
      postVolume: 10,
      qualifiedPostVolume: 2,
      sampledPostVolume: 10,
      scoreSum: 100,
      commentSum: 20,
      subscriberCount: 12_000,
      activeUserCount: 500,
      activePostRatio: 1,
      dispersionScore: 0.5,
      impactScoreSum: 30,
      impactPostVolume: 2,
      topImpactShare: 0.6,
      heatPrice: 35,
      heatChangePct: 0,
      ema7: 35,
      ema30: 35,
      subredditTier: "small",
      qualityThresholdScore: 10,
      qualityThresholdComments: 5,
      algorithmVersion: "daily_fact_v1",
      explainPayload: {},
    },
  ]);

  await repos.keywordTrendDailyRepository.upsertMany([
    {
      targetId,
      day: "2026-04-10",
      keyword: "ai",
      sampledPosts: 10,
      matchedPosts: 3,
      qualifiedMatchedPosts: 1,
      mentionRate: 0.3,
      qualifiedMentionRate: 0.1,
      matchedScoreSum: 100,
      matchedCommentSum: 40,
      keywordHeat: 0.5,
      sourceType: "live",
    },
  ]);

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const result = await getJson<{
      ok: boolean;
      daily: Array<{ heatPrice: number; qualifiedPostVolume: number }>;
      keywordHeat: Array<{ keyword: string; totalMentions: number }>;
    }>(
      `${baseUrl}/v1/trends/subreddit/datascience/daily?from=2026-04-10T00:00:00.000Z&to=2026-04-12T23:59:59.000Z&keywords=ai`,
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.daily[0]?.heatPrice, 35);
    assert.equal(result.body.daily[0]?.qualifiedPostVolume, 2);
    assert.equal(result.body.keywordHeat.find((item) => item.keyword === "ai")?.totalMentions, 3);
  } finally {
    await stopServer(server);
  }
});

test("api server returns daily insights and keyword heat", async () => {
  const fixedNow = "2026-04-12T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetId = stableUuidFromString("reddit:target:r/datascience");

  await repos.monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/datascience",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });

  await repos.subredditTrendPointRepository.upsertMany([
    {
      targetId,
      windowStart: "2026-04-10T10:00:00.000Z",
      windowEnd: "2026-04-10T10:15:00.000Z",
      newPosts: 10,
      commentSum: 20,
      deltaNewPostsVsPrevWindow: 0,
      deltaActiveUsersVsPrevWindow: 0,
      trendScore: 0.1,
    },
    {
      targetId,
      windowStart: "2026-04-11T10:00:00.000Z",
      windowEnd: "2026-04-11T10:15:00.000Z",
      newPosts: 12,
      commentSum: 30,
      deltaNewPostsVsPrevWindow: 2,
      deltaActiveUsersVsPrevWindow: 0,
      trendScore: 0.2,
    },
    {
      targetId,
      windowStart: "2026-04-12T10:00:00.000Z",
      windowEnd: "2026-04-12T10:15:00.000Z",
      newPosts: 40,
      commentSum: 90,
      deltaNewPostsVsPrevWindow: 28,
      deltaActiveUsersVsPrevWindow: 0,
      trendScore: 0.7,
    },
  ]);

  await repos.contentRepository.upsertMany([
    {
      id: stableUuidFromString("reddit:content:t3_a"),
      source: "reddit",
      targetId,
      externalId: "t3_a",
      kind: "post",
      title: "AI product benchmark",
      bodyText: "llm and ai trend",
      permalink: "/r/datascience/comments/a",
      createdAtSource: "2026-04-10T11:00:00.000Z",
      firstSeenAt: "2026-04-10T11:00:00.000Z",
      lastSeenAt: "2026-04-10T11:00:00.000Z",
    },
    {
      id: stableUuidFromString("reddit:content:t3_b"),
      source: "reddit",
      targetId,
      externalId: "t3_b",
      kind: "post",
      title: "LLM ops checklist",
      bodyText: "agent stack",
      permalink: "/r/datascience/comments/b",
      createdAtSource: "2026-04-11T11:00:00.000Z",
      firstSeenAt: "2026-04-11T11:00:00.000Z",
      lastSeenAt: "2026-04-11T11:00:00.000Z",
    },
    {
      id: stableUuidFromString("reddit:content:t3_c"),
      source: "reddit",
      targetId,
      externalId: "t3_c",
      kind: "post",
      title: "AI agents in production",
      bodyText: "ai ai",
      permalink: "/r/datascience/comments/c",
      createdAtSource: "2026-04-12T11:00:00.000Z",
      firstSeenAt: "2026-04-12T11:00:00.000Z",
      lastSeenAt: "2026-04-12T11:00:00.000Z",
    },
  ]);

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const result = await getJson<{
      ok: boolean;
      canonicalName: string;
      dayCount: number;
      daily: Array<{ day: string; totalNewPosts: number }>;
      keywordHeat: Array<{ keyword: string; totalMentions: number }>;
    }>(
      `${baseUrl}/v1/trends/subreddit/datascience/daily?from=2026-04-10T00:00:00.000Z&to=2026-04-12T23:59:59.000Z&keywords=ai,llm`,
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.canonicalName, "r/datascience");
    assert.equal(result.body.dayCount, 3);
    assert.equal(result.body.daily[2]?.totalNewPosts, 40);
    assert.equal(result.body.keywordHeat.find((item) => item.keyword === "ai")?.totalMentions, 2);
    assert.equal(
      result.body.keywordHeat.find((item) => item.keyword === "llm")?.totalMentions,
      2,
    );
  } finally {
    await stopServer(server);
  }
});

test("api server returns market rankings across subreddits", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetAi = stableUuidFromString("reddit:target:r/artificial");
  const targetMl = stableUuidFromString("reddit:target:r/machinelearning");

  await repos.monitorTargetRepository.upsert({
    id: targetAi,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/artificial",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  await repos.monitorTargetRepository.upsert({
    id: targetMl,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/machinelearning",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });

  await repos.subredditTrendPointRepository.upsertMany([
    {
      targetId: targetAi,
      windowStart: "2026-04-10T11:45:00.000Z",
      windowEnd: "2026-04-10T12:00:00.000Z",
      newPosts: 12,
      scoreSum: 1000,
      commentSum: 300,
      highScorePostCount: 6,
      sampledPostCount: 12,
      activePostRatio: 0.9,
      deltaNewPostsVsPrevWindow: 8,
      deltaActiveUsersVsPrevWindow: 120,
      heatChangePct: 0.7,
      heatIndex: 88,
      surgeScore: 0.8,
      dispersionScore: 0.74,
      trendScore: 0.62,
    },
    {
      targetId: targetMl,
      windowStart: "2026-04-10T11:45:00.000Z",
      windowEnd: "2026-04-10T12:00:00.000Z",
      newPosts: 8,
      scoreSum: 450,
      commentSum: 170,
      highScorePostCount: 3,
      sampledPostCount: 8,
      activePostRatio: 0.82,
      deltaNewPostsVsPrevWindow: 2,
      deltaActiveUsersVsPrevWindow: 40,
      heatChangePct: 0.25,
      heatIndex: 63,
      surgeScore: 0.42,
      dispersionScore: 0.86,
      trendScore: 0.31,
    },
  ]);

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const marketResult = await getJson<{
      ok: boolean;
      requestId: string;
      targetCount: number;
      rankings: {
        byHeat: Array<{ canonicalName: string }>;
        bySurge: Array<{ canonicalName: string }>;
        byDispersion: Array<{ canonicalName: string }>;
      };
    }>(
      `${baseUrl}/v1/trends/market?from=2026-04-10T10:00:00.000Z&to=2026-04-10T12:15:00.000Z&limit=5`,
    );
    assert.equal(marketResult.status, 200);
    assert.equal(marketResult.body.ok, true);
    assert.equal(marketResult.body.targetCount, 2);
    assert.equal(marketResult.body.rankings.byHeat[0]?.canonicalName, "r/artificial");
    assert.equal(marketResult.body.rankings.bySurge[0]?.canonicalName, "r/artificial");
    assert.equal(marketResult.body.rankings.byDispersion[0]?.canonicalName, "r/machinelearning");
  } finally {
    await stopServer(server);
  }
});

test("api server validates recentPostsLimit query parameter", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    await postJson(`${baseUrl}/v1/targets/subreddit`, { subreddit: "datascience" });
    await postJson(`${baseUrl}/v1/runs/reddit-phase1`, {
      mode: "mock",
      subreddit: "datascience",
      async: false,
    });

    const result = await getJson<{ ok: boolean; errorCode: string }>(
      `${baseUrl}/v1/trends/subreddit/datascience?recentPostsLimit=100`,
    );
    assert.equal(result.status, 400);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.errorCode, "invalid_query_param");
  } finally {
    await stopServer(server);
  }
});

test("api server returns 400 for malformed URL-encoded subreddit path", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const trendResult = await getJson<{ ok: boolean; errorCode: string; requestId: string }>(
      `${baseUrl}/v1/trends/subreddit/%E0%A4%A`,
    );
    assert.equal(trendResult.status, 400);
    assert.equal(trendResult.body.ok, false);
    assert.equal(trendResult.body.errorCode, "invalid_subreddit");
    assert.equal(trendResult.body.requestId, trendResult.requestId);

    const dailyResult = await getJson<{ ok: boolean; errorCode: string; requestId: string }>(
      `${baseUrl}/v1/trends/subreddit/%E0%A4%A/daily`,
    );
    assert.equal(dailyResult.status, 400);
    assert.equal(dailyResult.body.ok, false);
    assert.equal(dailyResult.body.errorCode, "invalid_subreddit");
    assert.equal(dailyResult.body.requestId, dailyResult.requestId);
  } finally {
    await stopServer(server);
  }
});
