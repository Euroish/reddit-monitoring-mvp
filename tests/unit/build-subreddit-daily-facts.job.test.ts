import test from "node:test";
import assert from "node:assert/strict";
import { buildSubredditDailyFactsJob } from "../../src/jobs/build-subreddit-daily-facts.job";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryContentRepository,
  InMemoryMetricsSnapshotRepository,
  InMemorySubredditDailyFactRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";

test("buildSubredditDailyFactsJob materializes continuous day facts with tier-aware qualification", async () => {
  const targetId = stableUuidFromString("reddit:target:r/datascience");
  const contentAId = stableUuidFromString("reddit:content:t3_a");
  const contentBId = stableUuidFromString("reddit:content:t3_b");
  const contentCId = stableUuidFromString("reddit:content:t3_c");
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const subredditDailyFactRepository = new InMemorySubredditDailyFactRepository();

  await contentRepository.upsertMany([
    {
      id: contentAId,
      source: "reddit",
      targetId,
      externalId: "t3_a",
      kind: "post",
      title: "Strong launch",
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
      title: "Small note",
      permalink: "/r/datascience/comments/b",
      createdAtSource: "2026-04-10T12:00:00.000Z",
      firstSeenAt: "2026-04-10T12:00:00.000Z",
      lastSeenAt: "2026-04-10T12:00:00.000Z",
    },
    {
      id: contentCId,
      source: "reddit",
      targetId,
      externalId: "t3_c",
      kind: "post",
      title: "Second day winner",
      permalink: "/r/datascience/comments/c",
      createdAtSource: "2026-04-11T13:00:00.000Z",
      firstSeenAt: "2026-04-11T13:00:00.000Z",
      lastSeenAt: "2026-04-11T13:00:00.000Z",
    },
  ]);

  await metricsSnapshotRepository.appendMany([
    {
      snapshotAt: "2026-04-10T12:05:00.000Z",
      source: "reddit",
      targetId,
      contentId: contentAId,
      granularity: "15m",
      metricName: "score",
      metricValue: 50,
      collectionJobId: stableUuidFromString("job:score:a"),
    },
    {
      snapshotAt: "2026-04-10T12:05:00.000Z",
      source: "reddit",
      targetId,
      contentId: contentAId,
      granularity: "15m",
      metricName: "num_comments",
      metricValue: 20,
      collectionJobId: stableUuidFromString("job:comments:a"),
    },
    {
      snapshotAt: "2026-04-10T12:05:00.000Z",
      source: "reddit",
      targetId,
      contentId: contentBId,
      granularity: "15m",
      metricName: "score",
      metricValue: 4,
      collectionJobId: stableUuidFromString("job:score:b"),
    },
    {
      snapshotAt: "2026-04-10T12:05:00.000Z",
      source: "reddit",
      targetId,
      contentId: contentBId,
      granularity: "15m",
      metricName: "num_comments",
      metricValue: 1,
      collectionJobId: stableUuidFromString("job:comments:b"),
    },
    {
      snapshotAt: "2026-04-11T13:05:00.000Z",
      source: "reddit",
      targetId,
      contentId: contentCId,
      granularity: "15m",
      metricName: "score",
      metricValue: 30,
      collectionJobId: stableUuidFromString("job:score:c"),
    },
    {
      snapshotAt: "2026-04-11T13:05:00.000Z",
      source: "reddit",
      targetId,
      contentId: contentCId,
      granularity: "15m",
      metricName: "num_comments",
      metricValue: 12,
      collectionJobId: stableUuidFromString("job:comments:c"),
    },
    {
      snapshotAt: "2026-04-10T10:00:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "subscribers",
      metricValue: 12_000,
      collectionJobId: stableUuidFromString("job:about:1"),
    },
    {
      snapshotAt: "2026-04-10T10:00:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "active_users",
      metricValue: 500,
      collectionJobId: stableUuidFromString("job:about:2"),
    },
    {
      snapshotAt: "2026-04-11T10:00:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "subscribers",
      metricValue: 12_500,
      collectionJobId: stableUuidFromString("job:about:3"),
    },
    {
      snapshotAt: "2026-04-11T10:00:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "active_users",
      metricValue: 650,
      collectionJobId: stableUuidFromString("job:about:4"),
    },
  ]);

  const facts = await buildSubredditDailyFactsJob(
    {
      contentRepository,
      metricsSnapshotRepository,
      subredditDailyFactRepository,
    },
    {
      targetId,
      fromIso: "2026-04-10T00:00:00.000Z",
      toIso: "2026-04-12T23:59:59.000Z",
    },
  );

  assert.equal(facts.length, 3);
  assert.deepEqual(
    facts.map((fact) => fact.day),
    ["2026-04-10", "2026-04-11", "2026-04-12"],
  );

  const dayOne = facts[0]!;
  assert.equal(dayOne.subredditTier, "small");
  assert.equal(dayOne.postVolume, 2);
  assert.equal(dayOne.qualifiedPostVolume, 1);
  assert.equal(dayOne.qualityThresholdScore, 20);
  assert.equal(dayOne.qualityThresholdComments, 8);
  assert.equal(dayOne.heatPrice > 0, true);
  assert.equal(dayOne.algorithmVersion, "daily_fact_v1");

  const dayTwo = facts[1]!;
  assert.equal(dayTwo.postVolume, 1);
  assert.equal(dayTwo.qualifiedPostVolume, 1);
  assert.equal(dayTwo.subscriberCount, 12_500);
  assert.equal(dayTwo.activeUserCount, 650);
  assert.equal(dayTwo.ema7 > 0, true);

  const dayThree = facts[2]!;
  assert.equal(dayThree.postVolume, 0);
  assert.equal(dayThree.qualifiedPostVolume, 0);
  assert.equal(dayThree.subscriberCount, 12_500);
  assert.equal(dayThree.heatPrice, 0);

  assert.equal(subredditDailyFactRepository.all().length, 3);
});
