import assert from "node:assert/strict";
import test from "node:test";
import { buildAnomalyEventsJob } from "../../src/jobs/build-anomaly-events.job";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryAnomalyEventRepository,
  InMemoryKeywordTrendDailyRepository,
  InMemoryPostGrowthFactRepository,
  InMemorySubredditDailyFactRepository,
  InMemorySubredditTrendPointRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";

test("buildAnomalyEventsJob materializes volume/quality/keyword/driver events from persisted facts", async () => {
  const targetId = stableUuidFromString("reddit:target:r/machinelearning");
  const contentId = stableUuidFromString("reddit:content:driver-post");
  const subredditTrendPointRepository = new InMemorySubredditTrendPointRepository();
  const subredditDailyFactRepository = new InMemorySubredditDailyFactRepository();
  const keywordTrendDailyRepository = new InMemoryKeywordTrendDailyRepository();
  const postGrowthFactRepository = new InMemoryPostGrowthFactRepository();
  const anomalyEventRepository = new InMemoryAnomalyEventRepository();

  await subredditTrendPointRepository.upsertMany([
    {
      targetId,
      windowStart: "2026-04-13T00:00:00.000Z",
      windowEnd: "2026-04-13T06:00:00.000Z",
      granularity: "6h",
      newPosts: 220,
      deltaNewPostsVsPrevWindow: 170,
      deltaActiveUsersVsPrevWindow: 0,
      trendScore: 0.88,
      anomalyScore: 0.81,
      surgeScore: 0.92,
      sampleCount: 1,
      windowComplete: true,
    },
  ]);

  await subredditDailyFactRepository.upsertMany([
    createDailyFact(targetId, "2026-04-10", { postVolume: 100, qualifiedPostVolume: 20 }),
    createDailyFact(targetId, "2026-04-11", { postVolume: 110, qualifiedPostVolume: 22 }),
    createDailyFact(targetId, "2026-04-12", { postVolume: 95, qualifiedPostVolume: 19 }),
    createDailyFact(targetId, "2026-04-13", {
      postVolume: 120,
      qualifiedPostVolume: 78,
      heatChangePct: 0.75,
    }),
  ]);

  await keywordTrendDailyRepository.upsertMany([
    {
      targetId,
      day: "2026-04-13",
      keyword: "llm",
      track: "auto_keyword",
      normalizedQueryText: "llm",
      queryScope: "subreddit",
      sampledPosts: 120,
      matchedPosts: 16,
      qualifiedMatchedPosts: 11,
      mentionRate: 0.133333,
      qualifiedMentionRate: 0.091667,
      matchedScoreSum: 990,
      matchedCommentSum: 320,
      keywordHeat: 0.87,
      algorithmVersion: "keyword_trend_v2_dual_track",
      explainPayload: {},
      sourceType: "live",
    },
  ]);

  await postGrowthFactRepository.upsertMany([
    {
      targetId,
      contentId,
      ageBucket: "1h",
      observedAt: "2026-04-13T06:00:00.000Z",
      ageMinutes: 53,
      score: 420,
      comments: 120,
      scoreVelocityPerHour: 475.471698,
      commentVelocityPerHour: 135.849057,
      cohortPostCount: 18,
      cohortMedianScoreVelocity: 90,
      cohortMedianCommentVelocity: 40,
      velocityZScore: 3.4,
      driverScore: 91.2,
      algorithmVersion: "post_growth_v1",
      explainPayload: {},
    },
  ]);

  const rows = await buildAnomalyEventsJob(
    {
      anomalyEventRepository,
      subredditTrendPointRepository,
      subredditDailyFactRepository,
      keywordTrendDailyRepository,
      postGrowthFactRepository,
    },
    {
      targetId,
      fromIso: "2026-04-10T00:00:00.000Z",
      toIso: "2026-04-13T23:59:59.000Z",
    },
  );

  const signalTypes = new Set(rows.map((row) => row.signalType));
  assert.equal(signalTypes.has("volume"), true);
  assert.equal(signalTypes.has("quality"), true);
  assert.equal(signalTypes.has("keyword"), true);
  assert.equal(signalTypes.has("driver"), true);
  assert.equal(
    rows.every((row) => row.algorithmVersion === "anomaly_event_v2_tier_directional_quality"),
    true,
  );
  assert.equal(
    rows.some((row) => row.signalType === "quality" && row.signalKey === "quality_up"),
    true,
  );
  assert.equal(rows.some((row) => row.signalType === "keyword" && row.signalKey === "llm"), true);
  assert.equal(
    rows.some((row) => row.signalType === "driver" && row.signalKey === contentId),
    true,
  );

  const persisted = await anomalyEventRepository.listByTargetInRange({
    targetId,
    fromIso: "2026-04-10T00:00:00.000Z",
    toIso: "2026-04-14T00:00:00.000Z",
    limit: 100,
  });
  assert.equal(persisted.length, rows.length);
});

test("buildAnomalyEventsJob emits directional quality_down events on negative quality drift", async () => {
  const targetId = stableUuidFromString("reddit:target:r/quality-down");
  const subredditTrendPointRepository = new InMemorySubredditTrendPointRepository();
  const subredditDailyFactRepository = new InMemorySubredditDailyFactRepository();
  const keywordTrendDailyRepository = new InMemoryKeywordTrendDailyRepository();
  const postGrowthFactRepository = new InMemoryPostGrowthFactRepository();
  const anomalyEventRepository = new InMemoryAnomalyEventRepository();

  await subredditDailyFactRepository.upsertMany([
    createDailyFact(targetId, "2026-04-10", {
      postVolume: 100,
      qualifiedPostVolume: 70,
      heatChangePct: 0,
      subredditTier: "mid",
    }),
    createDailyFact(targetId, "2026-04-11", {
      postVolume: 100,
      qualifiedPostVolume: 68,
      heatChangePct: 0,
      subredditTier: "mid",
    }),
    createDailyFact(targetId, "2026-04-12", {
      postVolume: 100,
      qualifiedPostVolume: 30,
      heatChangePct: 1,
      subredditTier: "mid",
    }),
  ]);

  const rows = await buildAnomalyEventsJob(
    {
      anomalyEventRepository,
      subredditTrendPointRepository,
      subredditDailyFactRepository,
      keywordTrendDailyRepository,
      postGrowthFactRepository,
    },
    {
      targetId,
      fromIso: "2026-04-10T00:00:00.000Z",
      toIso: "2026-04-12T23:59:59.000Z",
    },
  );

  const qualityDown = rows.find(
    (row) => row.signalType === "quality" && row.signalKey === "quality_down",
  );
  assert.notEqual(qualityDown, undefined);
  assert.equal(qualityDown?.algorithmVersion, "anomaly_event_v2_tier_directional_quality");
  assert.equal((qualityDown?.explainPayload.direction as string | undefined) ?? "", "down");
});

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
