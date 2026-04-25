import test from "node:test";
import assert from "node:assert/strict";
import { buildTargetWorkbenchReadModel } from "../../src/application/services/target-workbench-read-model.service";
import type { SubredditDailyFact } from "../../src/domain/entities/subreddit-daily-fact";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";

test("target workbench data quality stays partial when materialized days have no observed posts", () => {
  const targetId = stableUuidFromString("reddit:target:r/overwatch");
  const generatedAtIso = "2026-04-24T12:00:00.000Z";
  const response = buildTargetWorkbenchReadModel({
    requestId: "test-request",
    generatedAtIso,
    target: {
      id: targetId,
      source: "reddit",
      targetType: "subreddit",
      canonicalName: "r/overwatch",
      status: "active",
      config: {},
      createdAt: generatedAtIso,
      updatedAt: generatedAtIso,
    },
    fromIso: "2026-04-22T00:00:00.000Z",
    toIso: "2026-04-24T23:59:59.000Z",
    timeframe: "1d",
    rangePreset: "7d",
    dailyFacts: [
      fact(targetId, "2026-04-22", { postVolume: 12, sampledPostVolume: 12 }),
      fact(targetId, "2026-04-23", { postVolume: 0, sampledPostVolume: 0 }),
      fact(targetId, "2026-04-24", { postVolume: 0, sampledPostVolume: 0 }),
    ],
    trendPoints: [],
    keywordDailyRows: [],
    postGrowthFacts: [],
    contents: [],
    anomalyEvents: [],
    providerHealthWindows: [],
  });

  assert.equal(response.dataQuality.status, "partial");
  assert.equal(response.dataQuality.coverage.expectedDayCount, 3);
  assert.equal(response.dataQuality.coverage.materializedDayCount, 3);
  assert.equal(response.dataQuality.coverage.observedPostDayCount, 1);
  assert.equal(response.dataQuality.coverage.zeroPostFactDayCount, 2);
  assert.deepEqual(response.dataQuality.coverage.degradedReasons, [
    "observed_post_days_missing",
  ]);
  assert.equal(
    response.dataQuality.notes.some((note) => note.includes("Reddit listing depth")),
    true,
  );
});

test("target workbench data quality marks sparse front-loaded backfill as partial", () => {
  const targetId = stableUuidFromString("reddit:target:r/nba");
  const generatedAtIso = "2026-04-24T12:00:00.000Z";
  const response = buildTargetWorkbenchReadModel({
    requestId: "test-request",
    generatedAtIso,
    target: {
      id: targetId,
      source: "reddit",
      targetType: "subreddit",
      canonicalName: "r/nba",
      status: "active",
      config: {},
      createdAt: generatedAtIso,
      updatedAt: generatedAtIso,
    },
    fromIso: "2026-04-10T00:00:00.000Z",
    toIso: "2026-04-24T23:59:59.000Z",
    timeframe: "1d",
    rangePreset: "30d",
    dailyFacts: [
      fact(targetId, "2026-04-10", { postVolume: 60, sampledPostVolume: 60 }),
      fact(targetId, "2026-04-11", { postVolume: 45, sampledPostVolume: 45 }),
      fact(targetId, "2026-04-12", { postVolume: 35, sampledPostVolume: 35 }),
      fact(targetId, "2026-04-13", { postVolume: 4, sampledPostVolume: 4 }),
      fact(targetId, "2026-04-14", { postVolume: 3, sampledPostVolume: 3 }),
      fact(targetId, "2026-04-15", { postVolume: 5, sampledPostVolume: 5 }),
      fact(targetId, "2026-04-16", { postVolume: 3, sampledPostVolume: 3 }),
      fact(targetId, "2026-04-17", { postVolume: 4, sampledPostVolume: 4 }),
      fact(targetId, "2026-04-18", { postVolume: 3, sampledPostVolume: 3 }),
      fact(targetId, "2026-04-19", { postVolume: 4, sampledPostVolume: 4 }),
      fact(targetId, "2026-04-20", { postVolume: 3, sampledPostVolume: 3 }),
      fact(targetId, "2026-04-21", { postVolume: 5, sampledPostVolume: 5 }),
      fact(targetId, "2026-04-22", { postVolume: 3, sampledPostVolume: 3 }),
      fact(targetId, "2026-04-23", { postVolume: 4, sampledPostVolume: 4 }),
      fact(targetId, "2026-04-24", { postVolume: 3, sampledPostVolume: 3 }),
    ],
    trendPoints: [],
    keywordDailyRows: [],
    postGrowthFacts: [],
    contents: [],
    anomalyEvents: [],
    providerHealthWindows: [],
  });

  assert.equal(response.dataQuality.status, "partial");
  assert.equal(response.dataQuality.coverage.materializedDayCount, 15);
  assert.equal(response.dataQuality.coverage.observedPostDayCount, 15);
  assert.equal(response.dataQuality.coverage.lowObservedPostDayCount, 12);
  assert.equal(response.dataQuality.coverage.minObservedPostsPerDay, 10);
  assert.equal(response.dataQuality.coverage.observedPostMedian, 4);
  assert.equal(
    response.dataQuality.coverage.degradedReasons.includes("low_observed_post_density"),
    true,
  );
  assert.equal(
    response.dataQuality.coverage.degradedReasons.includes("front_loaded_backfill_sample"),
    true,
  );
  assert.equal(
    response.indicators.find((indicator) => indicator.id === "total_new_posts")?.label,
    "Observed New Posts",
  );
});

function fact(
  targetId: string,
  day: string,
  overrides: {
    postVolume: number;
    sampledPostVolume: number;
  },
): SubredditDailyFact {
  return {
    targetId,
    day,
    postVolume: overrides.postVolume,
    qualifiedPostVolume: 0,
    sampledPostVolume: overrides.sampledPostVolume,
    scoreSum: 0,
    commentSum: 0,
    subscriberCount: 5_000_000,
    activeUserCount: 150_000,
    activePostRatio: 0,
    dispersionScore: 0,
    impactScoreSum: 0,
    impactPostVolume: 0,
    topImpactShare: 0,
    heatPrice: overrides.postVolume > 0 ? 20 : 0,
    heatChangePct: 0,
    ema7: overrides.postVolume > 0 ? 20 : 0,
    ema30: overrides.postVolume > 0 ? 20 : 0,
    subredditTier: "large",
    qualityThresholdScore: 40,
    qualityThresholdComments: 20,
    algorithmVersion: "daily_fact_v1",
    explainPayload: {},
  };
}
