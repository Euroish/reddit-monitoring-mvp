import test from "node:test";
import assert from "node:assert/strict";
import { buildSubredditKeywordTrendDailyJob } from "../../src/jobs/build-subreddit-keyword-trend-daily.job";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryContentRepository,
  InMemoryKeywordTrendDailyRepository,
  InMemoryMetricsSnapshotRepository,
  InMemoryPostEngagementRepository,
  InMemorySubredditDailyFactRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";

test("buildSubredditKeywordTrendDailyJob materializes mention and qualified rates", async () => {
  const targetId = stableUuidFromString("reddit:target:r/datascience");
  const contentAId = stableUuidFromString("reddit:content:t3_a");
  const contentBId = stableUuidFromString("reddit:content:t3_b");
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
  const keywordTrendDailyRepository = new InMemoryKeywordTrendDailyRepository();
  const subredditDailyFactRepository = new InMemorySubredditDailyFactRepository();

  await contentRepository.upsertMany([
    {
      id: contentAId,
      source: "reddit",
      targetId,
      externalId: "t3_a",
      kind: "post",
      title: "AI benchmark update",
      bodyText: "llm eval",
      permalink: "/r/datascience/comments/a",
      createdAtSource: "2026-04-10T11:00:00.000Z",
      firstSeenAt: "2026-04-10T11:00:00.000Z",
      lastSeenAt: "2026-04-10T11:00:00.000Z",
    },
    {
      id: contentBId,
      source: "reddit",
      targetId,
      externalId: "t3_b",
      kind: "post",
      title: "AI tooling",
      bodyText: "llm agents",
      permalink: "/r/datascience/comments/b",
      createdAtSource: "2026-04-10T12:00:00.000Z",
      firstSeenAt: "2026-04-10T12:00:00.000Z",
      lastSeenAt: "2026-04-10T12:00:00.000Z",
    },
  ]);

  await postEngagementRepository.upsertLatestMany([
    {
      contentId: contentAId,
      targetId,
      source: "reddit",
      observedAt: "2026-04-10T12:05:00.000Z",
      score: 25,
      numComments: 30,
      collectionJobId: stableUuidFromString("job:engagement:a"),
    },
    {
      contentId: contentBId,
      targetId,
      source: "reddit",
      observedAt: "2026-04-10T12:05:00.000Z",
      score: 5,
      numComments: 4,
      collectionJobId: stableUuidFromString("job:engagement:b"),
    },
  ]);

  const rows = await buildSubredditKeywordTrendDailyJob(
    {
      contentRepository,
      metricsSnapshotRepository,
      postEngagementRepository,
      keywordTrendDailyRepository,
      subredditDailyFactRepository,
    },
    {
      targetId,
      fromIso: "2026-04-10T00:00:00.000Z",
      toIso: "2026-04-10T23:59:59.000Z",
      qualityMinScore: 10,
      qualityMinComments: 20,
      maxKeywordsPerDay: 20,
    },
  );

  assert.equal(rows.length > 0, true);
  const llm = rows.find((row) => row.day === "2026-04-10" && row.keyword === "llm");
  assert.ok(llm);
  assert.equal(llm?.sampledPosts, 2);
  assert.equal(llm?.matchedPosts, 2);
  assert.equal(llm?.qualifiedMatchedPosts, 1);
  assert.equal(llm?.mentionRate, 1);
  assert.equal(llm?.qualifiedMentionRate, 0.5);
});

test("buildSubredditKeywordTrendDailyJob uses daily fact thresholds and denominator when available", async () => {
  const targetId = stableUuidFromString("reddit:target:r/machinelearning");
  const contentAId = stableUuidFromString("reddit:content:t3_override_a");
  const contentBId = stableUuidFromString("reddit:content:t3_override_b");
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
  const keywordTrendDailyRepository = new InMemoryKeywordTrendDailyRepository();
  const subredditDailyFactRepository = new InMemorySubredditDailyFactRepository();

  await contentRepository.upsertMany([
    {
      id: contentAId,
      source: "reddit",
      targetId,
      externalId: "t3_override_a",
      kind: "post",
      title: "Python model analysis",
      bodyText: "python benchmark",
      permalink: "/r/machinelearning/comments/override_a",
      createdAtSource: "2026-04-11T11:00:00.000Z",
      firstSeenAt: "2026-04-11T11:00:00.000Z",
      lastSeenAt: "2026-04-11T11:00:00.000Z",
    },
    {
      id: contentBId,
      source: "reddit",
      targetId,
      externalId: "t3_override_b",
      kind: "post",
      title: "Python notes",
      bodyText: "python tricks",
      permalink: "/r/machinelearning/comments/override_b",
      createdAtSource: "2026-04-11T12:00:00.000Z",
      firstSeenAt: "2026-04-11T12:00:00.000Z",
      lastSeenAt: "2026-04-11T12:00:00.000Z",
    },
  ]);

  await postEngagementRepository.upsertLatestMany([
    {
      contentId: contentAId,
      targetId,
      source: "reddit",
      observedAt: "2026-04-11T12:05:00.000Z",
      score: 25,
      numComments: 30,
      collectionJobId: stableUuidFromString("job:override:engagement:a"),
    },
    {
      contentId: contentBId,
      targetId,
      source: "reddit",
      observedAt: "2026-04-11T12:05:00.000Z",
      score: 12,
      numComments: 8,
      collectionJobId: stableUuidFromString("job:override:engagement:b"),
    },
  ]);

  await subredditDailyFactRepository.upsertMany([
    {
      targetId,
      day: "2026-04-11",
      postVolume: 4,
      qualifiedPostVolume: 0,
      sampledPostVolume: 4,
      scoreSum: 37,
      commentSum: 38,
      subscriberCount: 200_000,
      activeUserCount: 3_000,
      activePostRatio: 0.5,
      dispersionScore: 0.5,
      impactScoreSum: 20,
      impactPostVolume: 0,
      topImpactShare: 0.6,
      heatPrice: 40,
      heatChangePct: 0.1,
      ema7: 38,
      ema30: 35,
      subredditTier: "mid",
      qualityThresholdScore: 30,
      qualityThresholdComments: 20,
      algorithmVersion: "daily_fact_v1",
      explainPayload: {},
    },
  ]);

  const rows = await buildSubredditKeywordTrendDailyJob(
    {
      contentRepository,
      metricsSnapshotRepository,
      postEngagementRepository,
      keywordTrendDailyRepository,
      subredditDailyFactRepository,
    },
    {
      targetId,
      fromIso: "2026-04-11T00:00:00.000Z",
      toIso: "2026-04-11T23:59:59.000Z",
      qualityMinScore: 10,
      qualityMinComments: 5,
      maxKeywordsPerDay: 20,
    },
  );

  const python = rows.find((row) => row.day === "2026-04-11" && row.keyword === "python");
  assert.ok(python);
  assert.equal(python?.sampledPosts, 4);
  assert.equal(python?.matchedPosts, 2);
  assert.equal(python?.qualifiedMatchedPosts, 0);
  assert.equal(python?.mentionRate, 0.5);
  assert.equal(python?.qualifiedMentionRate, 0);
});

test("buildSubredditKeywordTrendDailyJob clamps sampled posts to observed posts when day fact volume lags", async () => {
  const targetId = stableUuidFromString("reddit:target:r/programming");
  const contentAId = stableUuidFromString("reddit:content:t3_floor_a");
  const contentBId = stableUuidFromString("reddit:content:t3_floor_b");
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
  const keywordTrendDailyRepository = new InMemoryKeywordTrendDailyRepository();
  const subredditDailyFactRepository = new InMemorySubredditDailyFactRepository();

  await contentRepository.upsertMany([
    {
      id: contentAId,
      source: "reddit",
      targetId,
      externalId: "t3_floor_a",
      kind: "post",
      title: "HTTPS rollout notes",
      bodyText: "https certificates",
      permalink: "/r/programming/comments/floor_a",
      createdAtSource: "2026-04-12T10:00:00.000Z",
      firstSeenAt: "2026-04-12T10:00:00.000Z",
      lastSeenAt: "2026-04-12T10:00:00.000Z",
    },
    {
      id: contentBId,
      source: "reddit",
      targetId,
      externalId: "t3_floor_b",
      kind: "post",
      title: "HTTPS migration",
      bodyText: "https proxy",
      permalink: "/r/programming/comments/floor_b",
      createdAtSource: "2026-04-12T11:00:00.000Z",
      firstSeenAt: "2026-04-12T11:00:00.000Z",
      lastSeenAt: "2026-04-12T11:00:00.000Z",
    },
  ]);

  await postEngagementRepository.upsertLatestMany([
    {
      contentId: contentAId,
      targetId,
      source: "reddit",
      observedAt: "2026-04-12T11:05:00.000Z",
      score: 20,
      numComments: 12,
      collectionJobId: stableUuidFromString("job:floor:engagement:a"),
    },
    {
      contentId: contentBId,
      targetId,
      source: "reddit",
      observedAt: "2026-04-12T11:05:00.000Z",
      score: 18,
      numComments: 14,
      collectionJobId: stableUuidFromString("job:floor:engagement:b"),
    },
  ]);

  await subredditDailyFactRepository.upsertMany([
    {
      targetId,
      day: "2026-04-12",
      postVolume: 1,
      qualifiedPostVolume: 1,
      sampledPostVolume: 1,
      scoreSum: 38,
      commentSum: 26,
      subscriberCount: 800_000,
      activeUserCount: 25_000,
      activePostRatio: 0.3,
      dispersionScore: 0.4,
      impactScoreSum: 24,
      impactPostVolume: 1,
      topImpactShare: 0.5,
      heatPrice: 55,
      heatChangePct: 0.2,
      ema7: 48,
      ema30: 40,
      subredditTier: "large",
      qualityThresholdScore: 10,
      qualityThresholdComments: 10,
      algorithmVersion: "daily_fact_v1",
      explainPayload: {},
    },
  ]);

  const rows = await buildSubredditKeywordTrendDailyJob(
    {
      contentRepository,
      metricsSnapshotRepository,
      postEngagementRepository,
      keywordTrendDailyRepository,
      subredditDailyFactRepository,
    },
    {
      targetId,
      fromIso: "2026-04-12T00:00:00.000Z",
      toIso: "2026-04-12T23:59:59.000Z",
      qualityMinScore: 10,
      qualityMinComments: 10,
      maxKeywordsPerDay: 20,
    },
  );

  const https = rows.find((row) => row.day === "2026-04-12" && row.keyword === "https");
  assert.ok(https);
  assert.equal(https?.sampledPosts, 2);
  assert.equal(https?.matchedPosts, 2);
  assert.equal(https?.qualifiedMatchedPosts, 2);
  assert.equal(https?.mentionRate, 1);
  assert.equal(https?.qualifiedMentionRate, 1);
});

test("buildSubredditKeywordTrendDailyJob materializes explicit queries alongside auto keywords", async () => {
  const targetId = stableUuidFromString("reddit:target:r/artificial");
  const contentId = stableUuidFromString("reddit:content:t3_explicit_query");
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
  const keywordTrendDailyRepository = new InMemoryKeywordTrendDailyRepository();
  const subredditDailyFactRepository = new InMemorySubredditDailyFactRepository();

  await contentRepository.upsertMany([
    {
      id: contentId,
      source: "reddit",
      targetId,
      externalId: "t3_explicit_query",
      kind: "post",
      title: "Large language model agent design notes",
      bodyText: "artificial intelligence deployment checklist",
      permalink: "/r/artificial/comments/explicit_query",
      createdAtSource: "2026-04-13T10:00:00.000Z",
      firstSeenAt: "2026-04-13T10:00:00.000Z",
      lastSeenAt: "2026-04-13T10:00:00.000Z",
    },
  ]);

  await postEngagementRepository.upsertLatestMany([
    {
      contentId,
      targetId,
      source: "reddit",
      observedAt: "2026-04-13T10:05:00.000Z",
      score: 20,
      numComments: 15,
      collectionJobId: stableUuidFromString("job:explicit:engagement"),
    },
  ]);

  const rows = await buildSubredditKeywordTrendDailyJob(
    {
      contentRepository,
      metricsSnapshotRepository,
      postEngagementRepository,
      keywordTrendDailyRepository,
      subredditDailyFactRepository,
    },
    {
      targetId,
      canonicalSubreddit: "r/artificial",
      explicitQueries: ["llm agent", "global: ai"],
      fromIso: "2026-04-13T00:00:00.000Z",
      toIso: "2026-04-13T23:59:59.000Z",
      qualityMinScore: 10,
      qualityMinComments: 10,
      maxKeywordsPerDay: 10,
      maxExplicitQueriesPerDay: 10,
    },
  );

  const autoAgent = rows.find(
    (row) => row.track === "auto_keyword" && row.normalizedQueryText === "agent",
  );
  const explicitLlmAgent = rows.find(
    (row) => row.track === "explicit_query" && row.normalizedQueryText === "llm agent",
  );
  const explicitAi = rows.find(
    (row) => row.track === "explicit_query" && row.normalizedQueryText === "ai",
  );

  assert.ok(autoAgent);
  assert.ok(explicitLlmAgent);
  assert.ok(explicitAi);
  assert.equal(explicitLlmAgent?.queryScope, "subreddit");
  assert.equal(explicitAi?.queryScope, "global");
  assert.equal(explicitLlmAgent?.matchedPosts, 1);
  assert.equal(explicitAi?.matchedPosts, 1);
  assert.equal(explicitLlmAgent?.algorithmVersion, "keyword_trend_v2_dual_track");
  assert.equal(
    explicitLlmAgent?.explainPayload["plannerVersion"],
    "query_normalization_v2",
  );
});
