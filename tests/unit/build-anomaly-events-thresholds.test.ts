import assert from "node:assert/strict";
import test from "node:test";
import { ANOMALY_EVENT_DEFAULTS } from "../../src/jobs/anomaly-event-defaults";
import { buildAnomalyEventsJob } from "../../src/jobs/build-anomaly-events.job";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryAnomalyEventRepository,
  InMemoryKeywordTrendDailyRepository,
  InMemoryPostGrowthFactRepository,
  InMemorySubredditDailyFactRepository,
  InMemorySubredditTrendPointRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";

test("buildAnomalyEventsJob includes exact-threshold signal rows", async () => {
  const targetId = stableUuidFromString("reddit:target:r/threshold-exact");
  const contentId = stableUuidFromString("reddit:content:threshold-driver-exact");
  const deps = createDeps();

  await deps.subredditTrendPointRepository.upsertMany([
    {
      targetId,
      windowStart: "2026-04-13T00:00:00.000Z",
      windowEnd: "2026-04-13T06:00:00.000Z",
      granularity: "6h",
      newPosts: 120,
      deltaNewPostsVsPrevWindow: 50,
      deltaActiveUsersVsPrevWindow: 0,
      trendScore: 0.1,
      anomalyScore: ANOMALY_EVENT_DEFAULTS.minScore.volume,
      surgeScore: 0.1,
      sampleCount: 1,
      windowComplete: true,
    },
  ]);
  await deps.subredditDailyFactRepository.upsertMany([
    createDailyFact(targetId, "2026-04-11", {
      postVolume: 1_000_000,
      qualifiedPostVolume: 500_000,
      heatChangePct: 0,
    }),
    createDailyFact(targetId, "2026-04-12", {
      postVolume: 1_000_000,
      qualifiedPostVolume: 500_000,
      heatChangePct: 0,
    }),
    // Keep score just above the quality threshold to avoid float-rounding false negatives.
    createDailyFact(targetId, "2026-04-13", {
      postVolume: 1_000_000,
      qualifiedPostVolume: 700_001,
      heatChangePct: 1,
    }),
  ]);
  await deps.keywordTrendDailyRepository.upsertMany([
    {
      targetId,
      day: "2026-04-13",
      keyword: "edge",
      track: "auto_keyword",
      normalizedQueryText: "edge",
      queryScope: "subreddit",
      sampledPosts: 10,
      matchedPosts: 2,
      qualifiedMatchedPosts: 4,
      mentionRate: 0.2,
      qualifiedMentionRate: 0.4,
      matchedScoreSum: 100,
      matchedCommentSum: 20,
      keywordHeat: 0.6,
      algorithmVersion: "keyword_trend_v2_dual_track",
      explainPayload: {},
      sourceType: "live",
    },
  ]);
  await deps.postGrowthFactRepository.upsertMany([
    {
      targetId,
      contentId,
      ageBucket: "1h",
      observedAt: "2026-04-13T06:00:00.000Z",
      ageMinutes: 55,
      score: 120,
      comments: 20,
      scoreVelocityPerHour: 130,
      commentVelocityPerHour: 22,
      cohortPostCount: 10,
      cohortMedianScoreVelocity: 30,
      cohortMedianCommentVelocity: 8,
      velocityZScore: 1.4,
      driverScore: ANOMALY_EVENT_DEFAULTS.minScore.driver * 100,
      algorithmVersion: "post_growth_v1",
      explainPayload: {},
    },
  ]);

  const rows = await buildAnomalyEventsJob(
    {
      anomalyEventRepository: deps.anomalyEventRepository,
      subredditTrendPointRepository: deps.subredditTrendPointRepository,
      subredditDailyFactRepository: deps.subredditDailyFactRepository,
      keywordTrendDailyRepository: deps.keywordTrendDailyRepository,
      postGrowthFactRepository: deps.postGrowthFactRepository,
    },
    {
      targetId,
      fromIso: "2026-04-11T00:00:00.000Z",
      toIso: "2026-04-13T23:59:59.000Z",
    },
  );

  const typeSet = new Set(rows.map((row) => row.signalType));
  assert.deepEqual(
    Array.from(typeSet).sort((a, b) => a.localeCompare(b)),
    ["driver", "keyword", "quality", "volume"],
  );
});

test("buildAnomalyEventsJob excludes below-threshold rows", async () => {
  const targetId = stableUuidFromString("reddit:target:r/threshold-below");
  const contentId = stableUuidFromString("reddit:content:threshold-driver-below");
  const deps = createDeps();

  await deps.subredditTrendPointRepository.upsertMany([
    {
      targetId,
      windowStart: "2026-04-13T00:00:00.000Z",
      windowEnd: "2026-04-13T06:00:00.000Z",
      granularity: "6h",
      newPosts: 120,
      deltaNewPostsVsPrevWindow: 50,
      deltaActiveUsersVsPrevWindow: 0,
      trendScore: 0.1,
      anomalyScore: ANOMALY_EVENT_DEFAULTS.minScore.volume - 0.000001,
      surgeScore: 0.1,
      sampleCount: 1,
      windowComplete: true,
    },
  ]);
  await deps.subredditDailyFactRepository.upsertMany([
    createDailyFact(targetId, "2026-04-11", { postVolume: 100, qualifiedPostVolume: 50, heatChangePct: 0 }),
    createDailyFact(targetId, "2026-04-12", { postVolume: 100, qualifiedPostVolume: 50, heatChangePct: 0 }),
    createDailyFact(targetId, "2026-04-13", { postVolume: 100, qualifiedPostVolume: 69, heatChangePct: 0.96 }),
  ]);
  await deps.keywordTrendDailyRepository.upsertMany([
    {
      targetId,
      day: "2026-04-13",
      keyword: "edge",
      track: "auto_keyword",
      normalizedQueryText: "edge",
      queryScope: "subreddit",
      sampledPosts: 10,
      matchedPosts: 1,
      qualifiedMatchedPosts: 4,
      mentionRate: 0.1,
      qualifiedMentionRate: 0.4,
      matchedScoreSum: 100,
      matchedCommentSum: 20,
      keywordHeat: 0.585,
      algorithmVersion: "keyword_trend_v2_dual_track",
      explainPayload: {},
      sourceType: "live",
    },
  ]);
  await deps.postGrowthFactRepository.upsertMany([
    {
      targetId,
      contentId,
      ageBucket: "1h",
      observedAt: "2026-04-13T06:00:00.000Z",
      ageMinutes: 55,
      score: 120,
      comments: 20,
      scoreVelocityPerHour: 130,
      commentVelocityPerHour: 22,
      cohortPostCount: 10,
      cohortMedianScoreVelocity: 30,
      cohortMedianCommentVelocity: 8,
      velocityZScore: 1.4,
      driverScore: ANOMALY_EVENT_DEFAULTS.minScore.driver * 100 - 0.1,
      algorithmVersion: "post_growth_v1",
      explainPayload: {},
    },
  ]);

  const rows = await buildAnomalyEventsJob(
    {
      anomalyEventRepository: deps.anomalyEventRepository,
      subredditTrendPointRepository: deps.subredditTrendPointRepository,
      subredditDailyFactRepository: deps.subredditDailyFactRepository,
      keywordTrendDailyRepository: deps.keywordTrendDailyRepository,
      postGrowthFactRepository: deps.postGrowthFactRepository,
    },
    {
      targetId,
      fromIso: "2026-04-11T00:00:00.000Z",
      toIso: "2026-04-13T23:59:59.000Z",
    },
  );

  assert.equal(rows.length, 0);
});

test("buildAnomalyEventsJob applies tier-adaptive quality threshold floors", async () => {
  const microTargetId = stableUuidFromString("reddit:target:r/threshold-tier-micro");
  const largeTargetId = stableUuidFromString("reddit:target:r/threshold-tier-large");
  const deps = createDeps();

  await deps.subredditDailyFactRepository.upsertMany([
    createDailyFact(microTargetId, "2026-04-11", {
      postVolume: 100,
      qualifiedPostVolume: 50,
      heatChangePct: 0,
      subredditTier: "micro",
    }),
    createDailyFact(microTargetId, "2026-04-12", {
      postVolume: 100,
      qualifiedPostVolume: 50,
      heatChangePct: 0,
      subredditTier: "micro",
    }),
    createDailyFact(microTargetId, "2026-04-13", {
      postVolume: 100,
      qualifiedPostVolume: 70,
      heatChangePct: 1,
      subredditTier: "micro",
    }),
    createDailyFact(largeTargetId, "2026-04-11", {
      postVolume: 100,
      qualifiedPostVolume: 50,
      heatChangePct: 0,
      subredditTier: "large",
    }),
    createDailyFact(largeTargetId, "2026-04-12", {
      postVolume: 100,
      qualifiedPostVolume: 50,
      heatChangePct: 0,
      subredditTier: "large",
    }),
    createDailyFact(largeTargetId, "2026-04-13", {
      postVolume: 100,
      qualifiedPostVolume: 70,
      heatChangePct: 1,
      subredditTier: "large",
    }),
  ]);

  const [microRows, largeRows] = await Promise.all([
    buildAnomalyEventsJob(
      {
        anomalyEventRepository: deps.anomalyEventRepository,
        subredditTrendPointRepository: deps.subredditTrendPointRepository,
        subredditDailyFactRepository: deps.subredditDailyFactRepository,
        keywordTrendDailyRepository: deps.keywordTrendDailyRepository,
        postGrowthFactRepository: deps.postGrowthFactRepository,
      },
      {
        targetId: microTargetId,
        fromIso: "2026-04-11T00:00:00.000Z",
        toIso: "2026-04-13T23:59:59.000Z",
      },
    ),
    buildAnomalyEventsJob(
      {
        anomalyEventRepository: deps.anomalyEventRepository,
        subredditTrendPointRepository: deps.subredditTrendPointRepository,
        subredditDailyFactRepository: deps.subredditDailyFactRepository,
        keywordTrendDailyRepository: deps.keywordTrendDailyRepository,
        postGrowthFactRepository: deps.postGrowthFactRepository,
      },
      {
        targetId: largeTargetId,
        fromIso: "2026-04-11T00:00:00.000Z",
        toIso: "2026-04-13T23:59:59.000Z",
      },
    ),
  ]);

  assert.equal(
    microRows.some((row) => row.signalType === "quality"),
    false,
  );
  assert.equal(
    largeRows.some((row) => row.signalType === "quality"),
    true,
  );
});

function createDeps() {
  return {
    anomalyEventRepository: new InMemoryAnomalyEventRepository(),
    subredditTrendPointRepository: new InMemorySubredditTrendPointRepository(),
    subredditDailyFactRepository: new InMemorySubredditDailyFactRepository(),
    keywordTrendDailyRepository: new InMemoryKeywordTrendDailyRepository(),
    postGrowthFactRepository: new InMemoryPostGrowthFactRepository(),
  };
}

function createDailyFact(
  targetId: string,
  day: string,
  overrides: Partial<{
    postVolume: number;
    qualifiedPostVolume: number;
    heatChangePct: number;
    subredditTier: "micro" | "small" | "mid" | "large";
  }> = {},
) {
  return {
    targetId,
    day,
    postVolume: overrides.postVolume ?? 100,
    qualifiedPostVolume: overrides.qualifiedPostVolume ?? 20,
    sampledPostVolume: 80,
    scoreSum: 900,
    commentSum: 300,
    subscriberCount: 120_000,
    activeUserCount: 4_200,
    activePostRatio: 0.5,
    dispersionScore: 0.58,
    impactScoreSum: 120.4,
    impactPostVolume: 8,
    topImpactShare: 0.35,
    heatPrice: 0.62,
    heatChangePct: overrides.heatChangePct ?? 0.04,
    ema7: 0.55,
    ema30: 0.5,
    subredditTier: overrides.subredditTier ?? ("mid" as const),
    qualityThresholdScore: 30,
    qualityThresholdComments: 5,
    algorithmVersion: "daily_fact_v1",
    explainPayload: {},
  };
}
