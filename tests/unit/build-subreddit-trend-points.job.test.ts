import test from "node:test";
import assert from "node:assert/strict";
import { buildSubredditTrendPointsJob } from "../../src/jobs/build-subreddit-trend-points.job";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryMetricsSnapshotRepository,
  InMemoryPostEngagementRepository,
  InMemorySubredditDailyFactRepository,
  InMemorySubredditTrendPointRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";

test("buildSubredditTrendPointsJob uses day-fact thresholds for qualified post counting", async () => {
  const targetId = stableUuidFromString("reddit:target:r/datascience");
  const postAId = stableUuidFromString("reddit:content:t3_threshold_a");
  const postBId = stableUuidFromString("reddit:content:t3_threshold_b");
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
  const subredditTrendPointRepository = new InMemorySubredditTrendPointRepository();
  const subredditDailyFactRepository = new InMemorySubredditDailyFactRepository();

  await metricsSnapshotRepository.appendMany([
    {
      snapshotAt: "2026-04-11T12:30:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "new_posts_15m",
      metricValue: 2,
      collectionJobId: stableUuidFromString("job:new_posts"),
    },
    {
      snapshotAt: "2026-04-11T12:30:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "active_users",
      metricValue: 200,
      collectionJobId: stableUuidFromString("job:active_users"),
    },
    {
      snapshotAt: "2026-04-11T12:30:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "subscribers",
      metricValue: 50_000,
      collectionJobId: stableUuidFromString("job:subscribers"),
    },
  ]);
  await postEngagementRepository.upsertWindowedMany([
    {
      targetId,
      contentId: postAId,
      source: "reddit",
      windowStart: "2026-04-11T12:00:00.000Z",
      windowEnd: "2026-04-11T18:00:00.000Z",
      observedAt: "2026-04-11T12:30:00.000Z",
      score: 35,
      numComments: 30,
      collectionJobId: stableUuidFromString("job:window:a"),
    },
    {
      targetId,
      contentId: postBId,
      source: "reddit",
      windowStart: "2026-04-11T12:00:00.000Z",
      windowEnd: "2026-04-11T18:00:00.000Z",
      observedAt: "2026-04-11T12:30:00.000Z",
      score: 45,
      numComments: 25,
      collectionJobId: stableUuidFromString("job:window:b"),
    },
  ]);

  await subredditDailyFactRepository.upsertMany([
    {
      targetId,
      day: "2026-04-11",
      postVolume: 2,
      qualifiedPostVolume: 2,
      sampledPostVolume: 2,
      scoreSum: 80,
      commentSum: 55,
      subscriberCount: 50_000,
      activeUserCount: 200,
      activePostRatio: 1,
      dispersionScore: 0.5,
      impactScoreSum: 12,
      impactPostVolume: 2,
      topImpactShare: 0.6,
      heatPrice: 42,
      heatChangePct: 0.1,
      ema7: 40,
      ema30: 36,
      subredditTier: "mid",
      qualityThresholdScore: 30,
      qualityThresholdComments: 20,
      algorithmVersion: "daily_fact_v1",
      explainPayload: {},
    },
  ]);

  const points = await buildSubredditTrendPointsJob(
    {
      metricsSnapshotRepository,
      postEngagementRepository,
      subredditTrendPointRepository,
      subredditDailyFactRepository,
    },
    {
      targetId,
      fromIso: "2026-04-11T12:00:00.000Z",
      toIso: "2026-04-11T13:00:00.000Z",
    },
  );

  assert.equal(points.length, 1);
  assert.equal(points[0]?.sampledPostCount, 2);
  assert.equal(points[0]?.highScorePostCount, 2);
});

test("buildSubredditTrendPointsJob falls back to legacy high-score threshold without day facts", async () => {
  const targetId = stableUuidFromString("reddit:target:r/machinelearning");
  const postAId = stableUuidFromString("reddit:content:t3_legacy_a");
  const postBId = stableUuidFromString("reddit:content:t3_legacy_b");
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
  const subredditTrendPointRepository = new InMemorySubredditTrendPointRepository();

  await metricsSnapshotRepository.appendMany([
    {
      snapshotAt: "2026-04-12T12:30:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "new_posts_15m",
      metricValue: 2,
      collectionJobId: stableUuidFromString("job:legacy:new_posts"),
    },
    {
      snapshotAt: "2026-04-12T12:30:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "active_users",
      metricValue: 300,
      collectionJobId: stableUuidFromString("job:legacy:active_users"),
    },
    {
      snapshotAt: "2026-04-12T12:30:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "subscribers",
      metricValue: 150_000,
      collectionJobId: stableUuidFromString("job:legacy:subscribers"),
    },
  ]);
  await postEngagementRepository.upsertWindowedMany([
    {
      targetId,
      contentId: postAId,
      source: "reddit",
      windowStart: "2026-04-12T12:00:00.000Z",
      windowEnd: "2026-04-12T18:00:00.000Z",
      observedAt: "2026-04-12T12:30:00.000Z",
      score: 45,
      numComments: 25,
      collectionJobId: stableUuidFromString("job:legacy:window:a"),
    },
    {
      targetId,
      contentId: postBId,
      source: "reddit",
      windowStart: "2026-04-12T12:00:00.000Z",
      windowEnd: "2026-04-12T18:00:00.000Z",
      observedAt: "2026-04-12T12:30:00.000Z",
      score: 35,
      numComments: 40,
      collectionJobId: stableUuidFromString("job:legacy:window:b"),
    },
  ]);

  const points = await buildSubredditTrendPointsJob(
    {
      metricsSnapshotRepository,
      postEngagementRepository,
      subredditTrendPointRepository,
    },
    {
      targetId,
      fromIso: "2026-04-12T12:00:00.000Z",
      toIso: "2026-04-12T13:00:00.000Z",
    },
  );

  assert.equal(points.length, 1);
  assert.equal(points[0]?.sampledPostCount, 2);
  assert.equal(points[0]?.highScorePostCount, 0);
});
