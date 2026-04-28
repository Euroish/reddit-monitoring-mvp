import test from "node:test";
import assert from "node:assert/strict";
import { buildSubredditCollectionCoverageJob } from "../../src/jobs/build-subreddit-collection-coverage.job";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryContentRepository,
  InMemoryCrawlCursorRepository,
  InMemoryProviderHealthWindowRepository,
  InMemorySubredditCollectionCoverageRepository,
  InMemorySubredditDailyFactRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";

test("buildSubredditCollectionCoverageJob marks only backfill-proven days complete", async () => {
  const targetId = stableUuidFromString("reddit:target:r/coverage-small");
  const contentRepository = new InMemoryContentRepository();
  const dailyFactRepository = new InMemorySubredditDailyFactRepository();
  const coverageRepository = new InMemorySubredditCollectionCoverageRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();

  await contentRepository.upsertMany([
    {
      id: stableUuidFromString("reddit:content:t3_a"),
      source: "reddit",
      targetId,
      externalId: "t3_a",
      kind: "post",
      title: "Covered day post",
      permalink: "/r/coverage-small/comments/a",
      createdAtSource: "2026-04-10T10:00:00.000Z",
      firstSeenAt: "2026-04-10T12:00:00.000Z",
      lastSeenAt: "2026-04-10T12:00:00.000Z",
      totalEligible: true,
    },
    {
      id: stableUuidFromString("reddit:content:t3_b"),
      source: "reddit",
      targetId,
      externalId: "t3_b",
      kind: "post",
      title: "Partial day post",
      permalink: "/r/coverage-small/comments/b",
      createdAtSource: "2026-04-11T10:00:00.000Z",
      firstSeenAt: "2026-04-11T12:00:00.000Z",
      lastSeenAt: "2026-04-11T12:00:00.000Z",
      totalEligible: true,
    },
  ]);
  await dailyFactRepository.upsertMany([
    fact(targetId, "2026-04-10", 1),
    fact(targetId, "2026-04-11", 1),
  ]);
  await crawlCursorRepository.upsert({
    provider: "http",
    targetId,
    mode: "backfill",
    cursor: "t3_cursor",
    oldestObservedAt: "2026-04-11T00:00:00.000Z",
    newestObservedAt: "2026-04-11T10:00:00.000Z",
    backfillTargetFromIso: "2026-04-11T00:00:00.000Z",
    backfillCoverageStatus: "covered",
    backfillStopReason: "coverage_reached",
    updatedAt: "2026-04-12T00:00:00.000Z",
  });

  const rows = await buildSubredditCollectionCoverageJob(
    {
      contentRepository,
      subredditDailyFactRepository: dailyFactRepository,
      subredditCollectionCoverageRepository: coverageRepository,
      crawlCursorRepository,
    },
    {
      targetId,
      fromIso: "2026-04-10T00:00:00.000Z",
      toIso: "2026-04-11T23:59:59.000Z",
      generatedAtIso: "2026-04-12T00:00:00.000Z",
    },
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.coverageStatus, "partial");
  assert.equal(rows[0]?.coverageBasis, "observed_without_proof");
  assert.equal(rows[0]?.observedPostCount, 1);
  assert.equal(rows[1]?.coverageStatus, "complete");
  assert.equal(rows[1]?.coverageBasis, "backfill_reached_day_start");
  assert.equal(coverageRepository.all().length, 2);
});

test("buildSubredditCollectionCoverageJob marks continuous live evidence complete", async () => {
  const targetId = stableUuidFromString("reddit:target:r/coverage-live");
  const contentRepository = new InMemoryContentRepository();
  const dailyFactRepository = new InMemorySubredditDailyFactRepository();
  const coverageRepository = new InMemorySubredditCollectionCoverageRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();

  await dailyFactRepository.upsertMany([fact(targetId, "2026-04-10", 3)]);
  await crawlCursorRepository.upsert({
    provider: "http",
    targetId,
    mode: "live",
    cursor: "t3_live",
    liveRequestedFromIso: "2026-04-10T00:00:00.000Z",
    newestObservedAt: "2026-04-10T23:59:59.999Z",
    liveCoverageStatus: "complete",
    updatedAt: "2026-04-11T00:00:00.000Z",
  });

  const rows = await buildSubredditCollectionCoverageJob(
    {
      contentRepository,
      subredditDailyFactRepository: dailyFactRepository,
      subredditCollectionCoverageRepository: coverageRepository,
      crawlCursorRepository,
    },
    {
      targetId,
      fromIso: "2026-04-10T00:00:00.000Z",
      toIso: "2026-04-10T23:59:59.000Z",
      generatedAtIso: "2026-04-11T00:00:00.000Z",
    },
  );

  assert.equal(rows[0]?.coverageStatus, "complete");
  assert.equal(rows[0]?.coverageBasis, "live_continuous");
  assert.equal(rows[0]?.liveWindowCount, 1);
});

test("buildSubredditCollectionCoverageJob downgrades a day with a missed live window", async () => {
  const targetId = stableUuidFromString("reddit:target:r/coverage-missed");
  const contentRepository = new InMemoryContentRepository();
  const dailyFactRepository = new InMemorySubredditDailyFactRepository();
  const coverageRepository = new InMemorySubredditCollectionCoverageRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();

  await dailyFactRepository.upsertMany([fact(targetId, "2026-04-10", 2)]);
  await crawlCursorRepository.upsert({
    provider: "http",
    targetId,
    mode: "live",
    cursor: "t3_live_gap",
    liveRequestedFromIso: "2026-04-10T08:00:00.000Z",
    newestObservedAt: "2026-04-10T23:59:59.999Z",
    liveCoverageStatus: "complete",
    updatedAt: "2026-04-11T00:00:00.000Z",
  });

  const rows = await buildSubredditCollectionCoverageJob(
    {
      contentRepository,
      subredditDailyFactRepository: dailyFactRepository,
      subredditCollectionCoverageRepository: coverageRepository,
      crawlCursorRepository,
    },
    {
      targetId,
      fromIso: "2026-04-10T00:00:00.000Z",
      toIso: "2026-04-10T23:59:59.000Z",
      generatedAtIso: "2026-04-11T00:00:00.000Z",
    },
  );

  assert.equal(rows[0]?.coverageStatus, "partial");
  assert.equal(rows[0]?.coverageBasis, "missed_live_window");
  assert.equal(rows[0]?.missedLiveWindowCount, 1);
});

test("buildSubredditCollectionCoverageJob keeps iteration budget exhaustion as partial progress", async () => {
  const targetId = stableUuidFromString("reddit:target:r/coverage-budget");
  const contentRepository = new InMemoryContentRepository();
  const dailyFactRepository = new InMemorySubredditDailyFactRepository();
  const coverageRepository = new InMemorySubredditCollectionCoverageRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();

  await dailyFactRepository.upsertMany([fact(targetId, "2026-04-10", 4)]);
  await crawlCursorRepository.upsert({
    provider: "http",
    targetId,
    mode: "backfill",
    cursor: "t3_backfill",
    oldestObservedAt: "2026-04-10T12:00:00.000Z",
    newestObservedAt: "2026-04-10T23:00:00.000Z",
    backfillCoverageStatus: "progressing",
    backfillStopReason: "iteration_budget_exhausted",
    updatedAt: "2026-04-11T00:00:00.000Z",
  });

  const rows = await buildSubredditCollectionCoverageJob(
    {
      contentRepository,
      subredditDailyFactRepository: dailyFactRepository,
      subredditCollectionCoverageRepository: coverageRepository,
      crawlCursorRepository,
    },
    {
      targetId,
      fromIso: "2026-04-10T00:00:00.000Z",
      toIso: "2026-04-10T23:59:59.000Z",
      generatedAtIso: "2026-04-11T00:00:00.000Z",
    },
  );

  assert.equal(rows[0]?.coverageStatus, "partial");
  assert.equal(rows[0]?.coverageBasis, "iteration_budget_exhausted");
  assert.equal(rows[0]?.sourceLimited, false);
});

test("buildSubredditCollectionCoverageJob downgrades rate-limited live windows", async () => {
  const targetId = stableUuidFromString("reddit:target:r/coverage-rate-limited");
  const contentRepository = new InMemoryContentRepository();
  const dailyFactRepository = new InMemorySubredditDailyFactRepository();
  const coverageRepository = new InMemorySubredditCollectionCoverageRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();

  await dailyFactRepository.upsertMany([fact(targetId, "2026-04-10", 5)]);
  await providerHealthWindowRepository.record({
    provider: "http",
    targetId,
    mode: "live",
    windowStart: "2026-04-10T12:00:00.000Z",
    requestCountDelta: 3,
    successCountDelta: 1,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 5,
    acceptedCountDelta: 5,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 0,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 2,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    updatedAt: "2026-04-10T12:05:00.000Z",
  });

  const rows = await buildSubredditCollectionCoverageJob(
    {
      contentRepository,
      subredditDailyFactRepository: dailyFactRepository,
      subredditCollectionCoverageRepository: coverageRepository,
      crawlCursorRepository,
      providerHealthWindowRepository,
    },
    {
      targetId,
      fromIso: "2026-04-10T00:00:00.000Z",
      toIso: "2026-04-10T23:59:59.000Z",
      generatedAtIso: "2026-04-11T00:00:00.000Z",
    },
  );

  assert.equal(rows[0]?.coverageStatus, "partial");
  assert.equal(rows[0]?.coverageBasis, "rate_limited");
});

function fact(targetId: string, day: string, postVolume: number) {
  return {
    targetId,
    day,
    postVolume,
    qualifiedPostVolume: postVolume,
    sampledPostVolume: postVolume,
    scoreSum: postVolume,
    commentSum: postVolume,
    subscriberCount: 10_000,
    activeUserCount: 100,
    activePostRatio: 1,
    dispersionScore: 0,
    impactScoreSum: 0,
    impactPostVolume: 0,
    topImpactShare: 0,
    heatPrice: 1,
    heatChangePct: 0,
    ema7: 1,
    ema30: 1,
    subredditTier: "small" as const,
    qualityThresholdScore: 1,
    qualityThresholdComments: 1,
    algorithmVersion: "daily_fact_v1",
    explainPayload: {},
  };
}
