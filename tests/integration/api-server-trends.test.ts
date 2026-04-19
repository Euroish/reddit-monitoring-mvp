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
      track: "explicit_query",
      normalizedQueryText: "ai",
      queryScope: "subreddit",
      sampledPosts: 10,
      matchedPosts: 3,
      qualifiedMatchedPosts: 1,
      mentionRate: 0.3,
      qualifiedMentionRate: 0.1,
      matchedScoreSum: 100,
      matchedCommentSum: 40,
      keywordHeat: 0.5,
      algorithmVersion: "keyword_trend_v2_dual_track",
      explainPayload: {
        plannerVersion: "query_normalization_v2",
      },
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
      keywordHeat: Array<{ keyword: string; totalMentions: number; source: string }>;
    }>(
      `${baseUrl}/v1/trends/subreddit/datascience/daily?from=2026-04-10T00:00:00.000Z&to=2026-04-12T23:59:59.000Z&keywords=ai`,
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.daily[0]?.heatPrice, 35);
    assert.equal(result.body.daily[0]?.qualifiedPostVolume, 2);
    assert.equal(result.body.keywordHeat.find((item) => item.keyword === "ai")?.totalMentions, 3);
    assert.equal(
      result.body.keywordHeat.find((item) => item.keyword === "ai")?.source,
      "materialized_keyword_trend_daily",
    );
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

  await repos.keywordTrendDailyRepository.upsertMany([
    {
      targetId,
      day: "2026-04-10",
      keyword: "ai",
      track: "explicit_query",
      normalizedQueryText: "ai",
      queryScope: "subreddit",
      sampledPosts: 10,
      matchedPosts: 2,
      qualifiedMatchedPosts: 1,
      mentionRate: 0.2,
      qualifiedMentionRate: 0.1,
      matchedScoreSum: 30,
      matchedCommentSum: 10,
      keywordHeat: 0.2,
      algorithmVersion: "keyword_trend_v2_dual_track",
      explainPayload: {
        plannerVersion: "query_normalization_v2",
      },
      sourceType: "live",
    },
    {
      targetId,
      day: "2026-04-12",
      keyword: "ai",
      track: "explicit_query",
      normalizedQueryText: "ai",
      queryScope: "subreddit",
      sampledPosts: 10,
      matchedPosts: 1,
      qualifiedMatchedPosts: 1,
      mentionRate: 0.1,
      qualifiedMentionRate: 0.1,
      matchedScoreSum: 20,
      matchedCommentSum: 8,
      keywordHeat: 0.15,
      algorithmVersion: "keyword_trend_v2_dual_track",
      explainPayload: {
        plannerVersion: "query_normalization_v2",
      },
      sourceType: "live",
    },
    {
      targetId,
      day: "2026-04-10",
      keyword: "llm",
      track: "explicit_query",
      normalizedQueryText: "llm",
      queryScope: "subreddit",
      sampledPosts: 10,
      matchedPosts: 1,
      qualifiedMatchedPosts: 1,
      mentionRate: 0.1,
      qualifiedMentionRate: 0.1,
      matchedScoreSum: 35,
      matchedCommentSum: 12,
      keywordHeat: 0.23,
      algorithmVersion: "keyword_trend_v2_dual_track",
      explainPayload: {
        plannerVersion: "query_normalization_v2",
      },
      sourceType: "live",
    },
    {
      targetId,
      day: "2026-04-11",
      keyword: "llm",
      track: "explicit_query",
      normalizedQueryText: "llm",
      queryScope: "subreddit",
      sampledPosts: 10,
      matchedPosts: 0,
      qualifiedMatchedPosts: 0,
      mentionRate: 0,
      qualifiedMentionRate: 0,
      matchedScoreSum: 10,
      matchedCommentSum: 6,
      keywordHeat: 0.1,
      algorithmVersion: "keyword_trend_v2_dual_track",
      explainPayload: {
        plannerVersion: "query_normalization_v2",
      },
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
      canonicalName: string;
      dayCount: number;
      daily: Array<{ day: string; totalNewPosts: number }>;
      keywordHeat: Array<{ keyword: string; totalMentions: number; source: string }>;
    }>(
      `${baseUrl}/v1/trends/subreddit/datascience/daily?from=2026-04-10T00:00:00.000Z&to=2026-04-12T23:59:59.000Z&keywords=ai,llm`,
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.canonicalName, "r/datascience");
    assert.equal(result.body.dayCount, 3);
    assert.equal(result.body.daily[2]?.totalNewPosts, 40);
    assert.equal(result.body.keywordHeat.find((item) => item.keyword === "ai")?.totalMentions, 3);
    assert.equal(
      result.body.keywordHeat.find((item) => item.keyword === "llm")?.totalMentions,
      1,
    );
    assert.equal(
      result.body.keywordHeat.find((item) => item.keyword === "ai")?.source,
      "materialized_keyword_trend_daily",
    );
  } finally {
    await stopServer(server);
  }
});

test("api server daily insights filters explicit query scope for global and subreddit semantics", async () => {
  const fixedNow = "2026-04-12T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetId = stableUuidFromString("reddit:target:r/machinelearning");

  await repos.monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/machinelearning",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });

  await repos.keywordTrendDailyRepository.upsertMany([
    {
      targetId,
      day: "2026-04-10",
      keyword: "llm",
      track: "explicit_query",
      normalizedQueryText: "llm",
      queryScope: "subreddit",
      sampledPosts: 10,
      matchedPosts: 2,
      qualifiedMatchedPosts: 1,
      mentionRate: 0.2,
      qualifiedMentionRate: 0.1,
      matchedScoreSum: 60,
      matchedCommentSum: 20,
      keywordHeat: 0.4,
      algorithmVersion: "keyword_trend_v2_dual_track",
      explainPayload: {
        plannerVersion: "query_normalization_v2",
      },
      sourceType: "live",
    },
    {
      targetId,
      day: "2026-04-10",
      keyword: "llm",
      track: "explicit_query",
      normalizedQueryText: "llm",
      queryScope: "global",
      sampledPosts: 10,
      matchedPosts: 5,
      qualifiedMatchedPosts: 2,
      mentionRate: 0.5,
      qualifiedMentionRate: 0.2,
      matchedScoreSum: 100,
      matchedCommentSum: 40,
      keywordHeat: 0.7,
      algorithmVersion: "keyword_trend_v2_dual_track",
      explainPayload: {
        plannerVersion: "query_normalization_v2",
      },
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
    const globalResult = await getJson<{
      ok: boolean;
      keywordHeat: Array<{
        keyword: string;
        totalMentions: number;
        track?: string;
        queryScope?: string;
      }>;
    }>(
      `${baseUrl}/v1/trends/subreddit/machinelearning/daily?from=2026-04-10T00:00:00.000Z&to=2026-04-10T23:59:59.000Z&keywords=global:llm`,
    );
    assert.equal(globalResult.status, 200);
    assert.equal(globalResult.body.ok, true);
    assert.equal(globalResult.body.keywordHeat[0]?.totalMentions, 5);
    assert.equal(globalResult.body.keywordHeat[0]?.track, "explicit_query");
    assert.equal(globalResult.body.keywordHeat[0]?.queryScope, "global");

    const subredditResult = await getJson<{
      ok: boolean;
      keywordHeat: Array<{
        keyword: string;
        totalMentions: number;
        track?: string;
        queryScope?: string;
      }>;
    }>(
      `${baseUrl}/v1/trends/subreddit/machinelearning/daily?from=2026-04-10T00:00:00.000Z&to=2026-04-10T23:59:59.000Z&keywords=llm`,
    );
    assert.equal(subredditResult.status, 200);
    assert.equal(subredditResult.body.ok, true);
    assert.equal(subredditResult.body.keywordHeat[0]?.totalMentions, 2);
    assert.equal(subredditResult.body.keywordHeat[0]?.track, "explicit_query");
    assert.equal(subredditResult.body.keywordHeat[0]?.queryScope, "subreddit");

    const mixedScopeResult = await getJson<{
      ok: boolean;
      keywordHeat: Array<{
        keyword: string;
        totalMentions: number;
        track?: string;
        queryScope?: string;
      }>;
    }>(
      `${baseUrl}/v1/trends/subreddit/machinelearning/daily?from=2026-04-10T00:00:00.000Z&to=2026-04-10T23:59:59.000Z&keywords=global:llm,llm`,
    );
    assert.equal(mixedScopeResult.status, 200);
    assert.equal(mixedScopeResult.body.ok, true);
    assert.equal(mixedScopeResult.body.keywordHeat.length, 2);
    const globalKeyword = mixedScopeResult.body.keywordHeat.find(
      (item) => item.queryScope === "global",
    );
    const subredditKeyword = mixedScopeResult.body.keywordHeat.find(
      (item) => item.queryScope === "subreddit",
    );
    assert.equal(globalKeyword?.track, "explicit_query");
    assert.equal(globalKeyword?.totalMentions, 5);
    assert.equal(subredditKeyword?.track, "explicit_query");
    assert.equal(subredditKeyword?.totalMentions, 2);
  } finally {
    await stopServer(server);
  }
});

test("api server daily insights rejects invalid keyword query input", async () => {
  const fixedNow = "2026-04-12T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetId = stableUuidFromString("reddit:target:r/machinelearning");

  await repos.monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/machinelearning",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });
  const baseUrl = await startServer(server);
  try {
    const invalidKeywordResult = await getJson<{ ok: boolean; errorCode: string }>(
      `${baseUrl}/v1/trends/subreddit/machinelearning/daily?from=2026-04-10T00:00:00.000Z&to=2026-04-10T23:59:59.000Z&keywords=global:`,
    );
    assert.equal(invalidKeywordResult.status, 400);
    assert.equal(invalidKeywordResult.body.ok, false);
    assert.equal(invalidKeywordResult.body.errorCode, "invalid_query_param");
  } finally {
    await stopServer(server);
  }
});

test("api server returns global keyword daily trends aggregated across subreddits", async () => {
  const fixedNow = "2026-04-18T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const aiTargetId = stableUuidFromString("reddit:target:r/artificial");
  const mlTargetId = stableUuidFromString("reddit:target:r/machinelearning");

  await repos.monitorTargetRepository.upsert({
    id: aiTargetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/artificial",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  await repos.monitorTargetRepository.upsert({
    id: mlTargetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/machinelearning",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });

  await repos.keywordTrendDailyRepository.upsertMany([
    {
      targetId: aiTargetId,
      day: "2026-04-16",
      keyword: "ai infra",
      track: "explicit_query",
      normalizedQueryText: "ai infra",
      queryScope: "global",
      sampledPosts: 10,
      matchedPosts: 3,
      qualifiedMatchedPosts: 1,
      mentionRate: 0.3,
      qualifiedMentionRate: 0.1,
      matchedScoreSum: 90,
      matchedCommentSum: 30,
      keywordHeat: 0.5,
      algorithmVersion: "keyword_trend_v2_dual_track",
      explainPayload: {},
      sourceType: "live",
    },
    {
      targetId: mlTargetId,
      day: "2026-04-16",
      keyword: "ai infra",
      track: "explicit_query",
      normalizedQueryText: "ai infra",
      queryScope: "global",
      sampledPosts: 8,
      matchedPosts: 2,
      qualifiedMatchedPosts: 1,
      mentionRate: 0.25,
      qualifiedMentionRate: 0.125,
      matchedScoreSum: 60,
      matchedCommentSum: 24,
      keywordHeat: 0.45,
      algorithmVersion: "keyword_trend_v2_dual_track",
      explainPayload: {},
      sourceType: "backfill",
    },
    {
      targetId: aiTargetId,
      day: "2026-04-17",
      keyword: "ai infra",
      track: "explicit_query",
      normalizedQueryText: "ai infra",
      queryScope: "global",
      sampledPosts: 12,
      matchedPosts: 6,
      qualifiedMatchedPosts: 3,
      mentionRate: 0.5,
      qualifiedMentionRate: 0.25,
      matchedScoreSum: 180,
      matchedCommentSum: 72,
      keywordHeat: 0.7,
      algorithmVersion: "keyword_trend_v2_dual_track",
      explainPayload: {},
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
      queryScope: string;
      normalizedQueryText: string;
      dayCount: number;
      days: Array<{
        day: string;
        matchedPosts: number;
        qualifiedMatchedPosts: number;
        matchedSubredditCount: number;
        sourceTypes: string[];
        breakoutScore: number;
        isBreakout: boolean;
      }>;
    }>(
      `${baseUrl}/v1/trends/keywords/ai%20infra/daily?from=2026-04-16T00:00:00.000Z&to=2026-04-18T23:59:59.000Z`,
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.queryScope, "global");
    assert.equal(result.body.normalizedQueryText, "ai infra");
    assert.equal(result.body.dayCount, 3);
    assert.equal(result.body.days[0]?.day, "2026-04-16");
    assert.equal(result.body.days[0]?.matchedPosts, 5);
    assert.equal(result.body.days[0]?.qualifiedMatchedPosts, 2);
    assert.equal(result.body.days[0]?.matchedSubredditCount, 2);
    assert.deepEqual(result.body.days[0]?.sourceTypes, ["backfill", "live"]);
    assert.equal(result.body.days[1]?.day, "2026-04-17");
    assert.equal(result.body.days[1]?.matchedPosts, 6);
    assert.equal(result.body.days[1]?.isBreakout, true);
    assert.equal(result.body.days[2]?.day, "2026-04-18");
    assert.equal(result.body.days[2]?.matchedPosts, 0);
  } finally {
    await stopServer(server);
  }
});

test("api server global keyword daily trends reject subreddit-scoped queries", async () => {
  const fixedNow = "2026-04-18T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });
  const baseUrl = await startServer(server);
  try {
    const result = await getJson<{ ok: boolean; errorCode: string }>(
      `${baseUrl}/v1/trends/keywords/r%2Fmachinelearning%3A%20ai/daily?from=2026-04-16T00:00:00.000Z&to=2026-04-18T23:59:59.000Z`,
    );
    assert.equal(result.status, 400);
    assert.equal(result.body.ok, false);
    assert.equal(result.body.errorCode, "invalid_query_param");
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

test("api server returns subreddit driver posts from persisted growth facts", async () => {
  const fixedNow = "2026-04-17T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetId = stableUuidFromString("reddit:target:r/datascience");
  const contentAId = stableUuidFromString("reddit:content:t3_driver_a");
  const contentBId = stableUuidFromString("reddit:content:t3_driver_b");

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

  await repos.contentRepository.upsertMany([
    {
      id: contentAId,
      source: "reddit",
      targetId,
      externalId: "t3_driver_a",
      kind: "post",
      title: "LLM ranking benchmark",
      bodyText: "Benchmark notes for new model releases and scoring windows.",
      permalink: "/r/datascience/comments/driver_a",
      createdAtSource: "2026-04-17T08:00:00.000Z",
      firstSeenAt: "2026-04-17T08:05:00.000Z",
      lastSeenAt: "2026-04-17T11:20:00.000Z",
    },
    {
      id: contentBId,
      source: "reddit",
      targetId,
      externalId: "t3_driver_b",
      kind: "post",
      title: "Agent tooling launches",
      bodyText: "Fresh agent tooling release with strong early engagement.",
      permalink: "/r/datascience/comments/driver_b",
      createdAtSource: "2026-04-17T10:30:00.000Z",
      firstSeenAt: "2026-04-17T10:35:00.000Z",
      lastSeenAt: "2026-04-17T11:40:00.000Z",
    },
  ]);

  await repos.postSearchDocumentRepository.upsertMany([
    {
      contentId: contentAId,
      targetId,
      canonicalSubreddit: "r/datascience",
      title: "LLM ranking benchmark",
      bodySnippet: "Benchmark notes for new model releases and scoring windows.",
      permalink: "/r/datascience/comments/driver_a",
      createdAtSource: "2026-04-17T08:00:00.000Z",
    },
    {
      contentId: contentBId,
      targetId,
      canonicalSubreddit: "r/datascience",
      title: "Agent tooling launches",
      bodySnippet: "Fresh agent tooling release with strong early engagement.",
      permalink: "/r/datascience/comments/driver_b",
      createdAtSource: "2026-04-17T10:30:00.000Z",
    },
  ]);

  await repos.postGrowthFactRepository.upsertMany([
    {
      targetId,
      contentId: contentAId,
      ageBucket: "6h",
      observedAt: "2026-04-17T11:15:00.000Z",
      ageMinutes: 195,
      score: 320,
      comments: 58,
      scoreVelocityPerHour: 98.461538,
      commentVelocityPerHour: 17.846154,
      cohortPostCount: 24,
      cohortMedianScoreVelocity: 51.2,
      cohortMedianCommentVelocity: 10.4,
      velocityZScore: 1.4,
      driverScore: 71,
      algorithmVersion: "post_growth_v1",
      explainPayload: {
        cohort: {
          ageBucket: "6h",
        },
      },
    },
    {
      targetId,
      contentId: contentAId,
      ageBucket: "1h",
      observedAt: "2026-04-17T11:20:00.000Z",
      ageMinutes: 40,
      score: 180,
      comments: 34,
      scoreVelocityPerHour: 270,
      commentVelocityPerHour: 51,
      cohortPostCount: 18,
      cohortMedianScoreVelocity: 120,
      cohortMedianCommentVelocity: 18,
      velocityZScore: 2.2,
      driverScore: 83,
      algorithmVersion: "post_growth_v1",
      explainPayload: {
        normalized: {
          velocityZScore: 2.2,
        },
      },
    },
    {
      targetId,
      contentId: contentBId,
      ageBucket: "1h",
      observedAt: "2026-04-17T11:40:00.000Z",
      ageMinutes: 55,
      score: 210,
      comments: 41,
      scoreVelocityPerHour: 229.090909,
      commentVelocityPerHour: 44.727273,
      cohortPostCount: 18,
      cohortMedianScoreVelocity: 120,
      cohortMedianCommentVelocity: 18,
      velocityZScore: 2.8,
      driverScore: 92,
      algorithmVersion: "post_growth_v1",
      explainPayload: {
        normalized: {
          velocityZScore: 2.8,
        },
      },
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
      ageBuckets: string[];
      drivers: Array<{
        externalId: string;
        title: string;
        driverScore: number;
        ageBucket: string;
        labels: string[];
        explainPayload: Record<string, unknown>;
        bodySnippet?: string;
      }>;
    }>(
      `${baseUrl}/v1/trends/subreddit/datascience/drivers?from=2026-04-17T00:00:00.000Z&to=2026-04-17T12:00:00.000Z&ageBucket=1h&limit=5`,
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.canonicalName, "r/datascience");
    assert.deepEqual(result.body.ageBuckets, ["1h"]);
    assert.equal(result.body.drivers.length, 2);
      assert.equal(result.body.drivers[0]?.externalId, "t3_driver_b");
      assert.equal(result.body.drivers[0]?.driverScore, 92);
      assert.equal(result.body.drivers[0]?.ageBucket, "1h");
      assert.deepEqual(result.body.drivers[0]?.labels, ["breakout", "fresh"]);
      assert.deepEqual(result.body.drivers[0]?.explainPayload, {
        normalized: {
          velocityZScore: 2.8,
        },
      });
    assert.equal(result.body.drivers[1]?.externalId, "t3_driver_a");
    assert.equal(result.body.drivers[1]?.driverScore, 83);
    assert.equal(
      result.body.drivers[1]?.bodySnippet,
      "Benchmark notes for new model releases and scoring windows.",
    );

    const filtered = await getJson<{
      ok: boolean;
      drivers: Array<{
        externalId: string;
        matchedQueries?: string[];
        labels: string[];
      }>;
    }>(
      `${baseUrl}/v1/trends/subreddit/datascience/drivers?from=2026-04-17T00:00:00.000Z&to=2026-04-17T12:00:00.000Z&keywords=agent&limit=5`,
    );
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.ok, true);
    assert.equal(filtered.body.drivers.length, 1);
    assert.equal(filtered.body.drivers[0]?.externalId, "t3_driver_b");
    assert.deepEqual(filtered.body.drivers[0]?.matchedQueries, ["agent"]);
    assert.deepEqual(filtered.body.drivers[0]?.labels, ["breakout", "fresh"]);

    const invalidScope = await getJson<{ ok: boolean; errorCode: string }>(
      `${baseUrl}/v1/trends/subreddit/datascience/drivers?keywords=global:agent`,
    );
    assert.equal(invalidScope.status, 400);
    assert.equal(invalidScope.body.ok, false);
    assert.equal(invalidScope.body.errorCode, "invalid_query_param");
  } finally {
    await stopServer(server);
  }
});

test("api server returns subreddit anomaly feed from anomaly_event", async () => {
  const fixedNow = "2026-04-18T12:00:00.000Z";
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

  await repos.anomalyEventRepository.upsertMany([
    {
      targetId,
      signalType: "keyword",
      signalKey: "llm",
      observedAt: "2026-04-18T10:05:00.000Z",
      windowStart: "2026-04-18T10:00:00.000Z",
      windowEnd: "2026-04-18T10:15:00.000Z",
      anomalyScore: 0.62,
      algorithmVersion: "anomaly_event_v1",
      explainPayload: {
        supportCount: 12,
      },
    },
    {
      targetId,
      signalType: "volume",
      signalKey: "subreddit",
      observedAt: "2026-04-18T10:10:00.000Z",
      windowStart: "2026-04-18T10:00:00.000Z",
      windowEnd: "2026-04-18T10:15:00.000Z",
      anomalyScore: 0.9,
      algorithmVersion: "anomaly_event_v1",
      explainPayload: {
        postDelta: 30,
      },
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
      signalTypes: string[];
      events: Array<{
        signalType: string;
        signalKey: string;
        severity: string;
        anomalyScore: number;
      }>;
    }>(
      `${baseUrl}/v1/trends/subreddit/datascience/anomalies?from=2026-04-18T00:00:00.000Z&to=2026-04-18T23:59:59.000Z&signalType=keyword,volume&limit=10`,
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.deepEqual(result.body.signalTypes, ["keyword", "volume"]);
    assert.equal(result.body.events.length, 2);
    assert.equal(result.body.events[0]?.signalType, "volume");
    assert.equal(result.body.events[0]?.signalKey, "subreddit");
    assert.equal(result.body.events[0]?.severity, "high");
    assert.equal(result.body.events[0]?.anomalyScore, 0.9);
    assert.equal(result.body.events[1]?.signalType, "keyword");
    assert.equal(result.body.events[1]?.severity, "medium");

    const invalidSignalType = await getJson<{ ok: boolean; errorCode: string }>(
      `${baseUrl}/v1/trends/subreddit/datascience/anomalies?signalType=invalid`,
    );
    assert.equal(invalidSignalType.status, 400);
    assert.equal(invalidSignalType.body.ok, false);
    assert.equal(invalidSignalType.body.errorCode, "invalid_query_param");
  } finally {
    await stopServer(server);
  }
});

test("api server returns merged anomaly incidents from anomaly_event", async () => {
  const fixedNow = "2026-04-18T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetId = stableUuidFromString("reddit:target:r/machinelearning");

  await repos.monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/machinelearning",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });

  await repos.anomalyEventRepository.upsertMany([
    {
      targetId,
      signalType: "volume",
      signalKey: "subreddit",
      observedAt: "2026-04-18T11:05:00.000Z",
      windowStart: "2026-04-18T11:00:00.000Z",
      windowEnd: "2026-04-18T11:15:00.000Z",
      anomalyScore: 0.8,
      algorithmVersion: "anomaly_event_v1",
      explainPayload: {},
    },
    {
      targetId,
      signalType: "keyword",
      signalKey: "llm",
      observedAt: "2026-04-18T11:06:00.000Z",
      windowStart: "2026-04-18T11:00:00.000Z",
      windowEnd: "2026-04-18T11:15:00.000Z",
      anomalyScore: 0.62,
      algorithmVersion: "anomaly_event_v1",
      explainPayload: {},
    },
    {
      targetId,
      signalType: "driver",
      signalKey: "post-a",
      observedAt: "2026-04-18T11:25:00.000Z",
      windowStart: "2026-04-18T11:15:00.000Z",
      windowEnd: "2026-04-18T11:30:00.000Z",
      anomalyScore: 0.77,
      algorithmVersion: "anomaly_event_v1",
      explainPayload: {},
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
      signalTypes: string[];
      incidents: Array<{
        dominantSignalType: string;
        signalTypes: string[];
        signalCount: number;
        mergedScore: number;
        severity: string;
      }>;
    }>(
      `${baseUrl}/v1/trends/subreddit/machinelearning/anomalies/incidents?from=2026-04-18T00:00:00.000Z&to=2026-04-18T23:59:59.000Z&signalType=keyword,volume,driver&limit=10`,
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.deepEqual(result.body.signalTypes, ["keyword", "volume", "driver"]);
    assert.equal(result.body.incidents.length, 2);
    assert.equal(result.body.incidents[0]?.dominantSignalType, "volume");
    assert.deepEqual(result.body.incidents[0]?.signalTypes, ["keyword", "volume"]);
    assert.equal(result.body.incidents[0]?.signalCount, 2);
    assert.equal(result.body.incidents[0]?.mergedScore, 0.88);
    assert.equal(result.body.incidents[0]?.severity, "high");

    const invalidSignalType = await getJson<{ ok: boolean; errorCode: string }>(
      `${baseUrl}/v1/trends/subreddit/machinelearning/anomalies/incidents?signalType=bad`,
    );
    assert.equal(invalidSignalType.status, 400);
    assert.equal(invalidSignalType.body.ok, false);
    assert.equal(invalidSignalType.body.errorCode, "invalid_query_param");
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

    const anomalyResult = await getJson<{ ok: boolean; errorCode: string; requestId: string }>(
      `${baseUrl}/v1/trends/subreddit/%E0%A4%A/anomalies`,
    );
    assert.equal(anomalyResult.status, 400);
    assert.equal(anomalyResult.body.ok, false);
    assert.equal(anomalyResult.body.errorCode, "invalid_subreddit");
    assert.equal(anomalyResult.body.requestId, anomalyResult.requestId);

    const incidentResult = await getJson<{ ok: boolean; errorCode: string; requestId: string }>(
      `${baseUrl}/v1/trends/subreddit/%E0%A4%A/anomalies/incidents`,
    );
    assert.equal(incidentResult.status, 400);
    assert.equal(incidentResult.body.ok, false);
    assert.equal(incidentResult.body.errorCode, "invalid_subreddit");
    assert.equal(incidentResult.body.requestId, incidentResult.requestId);
  } finally {
    await stopServer(server);
  }
});
