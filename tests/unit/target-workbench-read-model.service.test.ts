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
  assert.equal(response.dataQuality.live.status, "missing");
  assert.equal(response.dataQuality.backfill.status, "missing");
  assert.equal(response.series[0]?.points[0]?.quality, "observed");
  assert.equal(response.series[0]?.points[1]?.quality, "observed_zero");
  assert.equal(response.series[0]?.points[1]?.value, 0);
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
  assert.equal(response.series[0]?.points[0]?.quality, "observed");
});

test("target workbench series marks uncovered days as missing with null values", () => {
  const targetId = stableUuidFromString("reddit:target:r/missingdays");
  const generatedAtIso = "2026-04-24T12:00:00.000Z";
  const response = buildTargetWorkbenchReadModel({
    requestId: "test-request",
    generatedAtIso,
    target: {
      id: targetId,
      source: "reddit",
      targetType: "subreddit",
      canonicalName: "r/missingdays",
      status: "active",
      config: {},
      createdAt: generatedAtIso,
      updatedAt: generatedAtIso,
    },
    fromIso: "2026-04-22T00:00:00.000Z",
    toIso: "2026-04-24T23:59:59.000Z",
    timeframe: "1d",
    rangePreset: "7d",
    dailyFacts: [fact(targetId, "2026-04-24", { postVolume: 12, sampledPostVolume: 12 })],
    trendPoints: [],
    keywordDailyRows: [],
    postGrowthFacts: [],
    contents: [],
    anomalyEvents: [],
    providerHealthWindows: [],
  });

  const heatSeries = response.series.find((series) => series.id === "heat_price");
  assert.equal(heatSeries?.points[0]?.quality, "missing");
  assert.equal(heatSeries?.points[0]?.value, null);
  assert.equal(heatSeries?.points[1]?.quality, "missing");
  assert.equal(heatSeries?.points[1]?.value, null);
  assert.equal(heatSeries?.points[2]?.quality, "observed");
  assert.equal(heatSeries?.points[2]?.value, 20);
});

test("target workbench exposes explicit backfill coverage state when cursor evidence exists", () => {
  const targetId = stableUuidFromString("reddit:target:r/askreddit");
  const generatedAtIso = "2026-04-24T12:00:00.000Z";
  const response = buildTargetWorkbenchReadModel({
    requestId: "test-request",
    generatedAtIso,
    target: {
      id: targetId,
      source: "reddit",
      targetType: "subreddit",
      canonicalName: "r/askreddit",
      status: "active",
      config: {},
      createdAt: generatedAtIso,
      updatedAt: generatedAtIso,
    },
    fromIso: "2026-04-10T00:00:00.000Z",
    toIso: "2026-04-24T23:59:59.000Z",
    timeframe: "1d",
    rangePreset: "30d",
    dailyFacts: [fact(targetId, "2026-04-24", { postVolume: 12, sampledPostVolume: 12 })],
    trendPoints: [],
    keywordDailyRows: [],
    postGrowthFacts: [],
    contents: [],
    anomalyEvents: [],
    providerHealthWindows: [],
    backfillCursor: {
      provider: "http",
      targetId,
      mode: "backfill",
      cursor: "t3_cursor_7",
      oldestObservedAt: "2026-04-22T00:00:00.000Z",
      newestObservedAt: "2026-04-24T12:00:00.000Z",
      backfillTargetFromIso: "2026-04-09T12:00:00.000Z",
      backfillCoverageStatus: "saturated_before_15d",
      backfillStopReason: "cursor_saturated",
      updatedAt: generatedAtIso,
    },
  });

  assert.equal(response.dataQuality.backfill.status, "saturated_before_15d");
  assert.equal(response.dataQuality.backfill.stopReason, "cursor_saturated");
  assert.equal(response.dataQuality.backfill.provider, "http");
  assert.equal(response.dataQuality.backfill.targetFromIso, "2026-04-09T12:00:00.000Z");
  assert.equal(response.dataQuality.backfill.observedDaySpan, 3);
});

test("target workbench exposes explicit live coverage state when live cursor evidence exists", () => {
  const targetId = stableUuidFromString("reddit:target:r/live-coverage");
  const generatedAtIso = "2026-04-24T12:00:00.000Z";
  const response = buildTargetWorkbenchReadModel({
    requestId: "test-request",
    generatedAtIso,
    target: {
      id: targetId,
      source: "reddit",
      targetType: "subreddit",
      canonicalName: "r/live-coverage",
      status: "active",
      config: {},
      createdAt: generatedAtIso,
      updatedAt: generatedAtIso,
    },
    fromIso: "2026-04-22T00:00:00.000Z",
    toIso: "2026-04-24T23:59:59.000Z",
    timeframe: "1d",
    rangePreset: "7d",
    dailyFacts: [fact(targetId, "2026-04-24", { postVolume: 12, sampledPostVolume: 12 })],
    trendPoints: [],
    keywordDailyRows: [],
    postGrowthFacts: [],
    contents: [],
    anomalyEvents: [],
    providerHealthWindows: [],
    liveCursor: {
      provider: "http",
      targetId,
      mode: "live",
      cursor: "t3_live_cursor",
      oldestObservedAt: "2026-04-24T06:00:00.000Z",
      newestObservedAt: "2026-04-24T11:45:00.000Z",
      liveRequestedFromIso: "2026-04-24T03:30:00.000Z",
      liveCoverageStatus: "source_limited",
      liveListingHorizonHit: true,
      updatedAt: generatedAtIso,
    },
  });

  assert.equal(response.dataQuality.live.status, "source_limited");
  assert.equal(response.dataQuality.live.provider, "http");
  assert.equal(response.dataQuality.live.requestedFromIso, "2026-04-24T03:30:00.000Z");
  assert.equal(response.dataQuality.live.oldestObservedAt, "2026-04-24T06:00:00.000Z");
  assert.equal(response.dataQuality.live.newestObservedAt, "2026-04-24T11:45:00.000Z");
  assert.equal(response.dataQuality.live.listingHorizonHit, true);
  assert.equal(response.dataQuality.live.observedHourSpan, 6);
});

test("target workbench downgrades zero-filled days before latest backfill window to missing", () => {
  const targetId = stableUuidFromString("reddit:target:r/overwatch-late-window");
  const generatedAtIso = "2026-04-26T12:00:00.000Z";
  const response = buildTargetWorkbenchReadModel({
    requestId: "test-request",
    generatedAtIso,
    target: {
      id: targetId,
      source: "reddit",
      targetType: "subreddit",
      canonicalName: "r/overwatch-late-window",
      status: "active",
      config: {},
      createdAt: generatedAtIso,
      updatedAt: generatedAtIso,
    },
    fromIso: "2026-04-21T00:00:00.000Z",
    toIso: "2026-04-24T23:59:59.000Z",
    timeframe: "1d",
    rangePreset: "7d",
    dailyFacts: [
      fact(targetId, "2026-04-21", { postVolume: 0, sampledPostVolume: 0 }),
      fact(targetId, "2026-04-22", { postVolume: 0, sampledPostVolume: 0 }),
      fact(targetId, "2026-04-23", { postVolume: 10, sampledPostVolume: 10 }),
      fact(targetId, "2026-04-24", { postVolume: 12, sampledPostVolume: 12 }),
    ],
    trendPoints: [],
    keywordDailyRows: [],
    postGrowthFacts: [],
    contents: [],
    anomalyEvents: [],
    providerHealthWindows: [],
    backfillCursor: {
      provider: "http",
      targetId,
      mode: "backfill",
      cursor: "t3_cursor_9",
      oldestObservedAt: "2026-04-23T04:27:25.000Z",
      newestObservedAt: "2026-04-24T12:00:00.000Z",
      backfillTargetFromIso: "2026-04-10T12:00:00.000Z",
      backfillCoverageStatus: "progressing",
      backfillStopReason: "iteration_budget_exhausted",
      updatedAt: generatedAtIso,
    },
  });

  const heatSeries = response.series.find((series) => series.id === "heat_price");
  assert.equal(heatSeries?.points[0]?.quality, "missing");
  assert.equal(heatSeries?.points[0]?.value, null);
  assert.equal(heatSeries?.points[1]?.quality, "missing");
  assert.equal(heatSeries?.points[1]?.value, null);
  assert.equal(heatSeries?.points[2]?.quality, "observed");
  assert.equal(heatSeries?.points[2]?.value, 20);
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
