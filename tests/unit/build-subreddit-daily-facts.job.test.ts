import test from "node:test";
import assert from "node:assert/strict";
import { buildSubredditDailyFactsJob } from "../../src/jobs/build-subreddit-daily-facts.job";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryContentRepository,
  InMemoryMetricsSnapshotRepository,
  InMemoryPostEngagementRepository,
  InMemorySubredditDailyFactRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";

test("buildSubredditDailyFactsJob skips uncovered days instead of materializing zero-value facts", async () => {
  const targetId = stableUuidFromString("reddit:target:r/datascience");
  const contentAId = stableUuidFromString("reddit:content:t3_a");
  const contentBId = stableUuidFromString("reddit:content:t3_b");
  const contentCId = stableUuidFromString("reddit:content:t3_c");
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
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
  await postEngagementRepository.upsertLatestMany([
    {
      contentId: contentAId,
      targetId,
      source: "reddit",
      observedAt: "2026-04-10T12:05:00.000Z",
      score: 50,
      numComments: 20,
      collectionJobId: stableUuidFromString("job:engagement:a"),
    },
    {
      contentId: contentBId,
      targetId,
      source: "reddit",
      observedAt: "2026-04-10T12:05:00.000Z",
      score: 4,
      numComments: 1,
      collectionJobId: stableUuidFromString("job:engagement:b"),
    },
    {
      contentId: contentCId,
      targetId,
      source: "reddit",
      observedAt: "2026-04-11T13:05:00.000Z",
      score: 30,
      numComments: 12,
      collectionJobId: stableUuidFromString("job:engagement:c"),
    },
  ]);

  const facts = await buildSubredditDailyFactsJob(
    {
      contentRepository,
      metricsSnapshotRepository,
      postEngagementRepository,
      subredditDailyFactRepository,
    },
    {
      targetId,
      fromIso: "2026-04-10T00:00:00.000Z",
      toIso: "2026-04-12T23:59:59.000Z",
    },
  );

  assert.equal(facts.length, 2);
  assert.deepEqual(
    facts.map((fact) => fact.day),
    ["2026-04-10", "2026-04-11"],
  );

  const dayOne = facts[0]!;
  assert.equal(dayOne.subredditTier, "small");
  assert.equal(dayOne.postVolume, 2);
  assert.equal(dayOne.qualifiedPostVolume, 1);
  assert.equal(dayOne.qualityThresholdScore, 15);
  assert.equal(dayOne.qualityThresholdComments, 5);
  assert.equal(dayOne.heatPrice > 0, true);
  assert.equal(dayOne.algorithmVersion, "daily_fact_v1");

  const dayTwo = facts[1]!;
  assert.equal(dayTwo.postVolume, 1);
  assert.equal(dayTwo.qualifiedPostVolume, 1);
  assert.equal(dayTwo.subscriberCount, 12_500);
  assert.equal(dayTwo.activeUserCount, 650);
  assert.equal(dayTwo.ema7 > 0, true);

  assert.equal(subredditDailyFactRepository.all().length, 2);
});

test("buildSubredditDailyFactsJob preserves observed zero-post days when collection windows exist", async () => {
  const targetId = stableUuidFromString("reddit:target:r/datascience:observed-zero");
  const contentId = stableUuidFromString("reddit:content:t3_observed");
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
  const subredditDailyFactRepository = new InMemorySubredditDailyFactRepository();

  await contentRepository.upsertMany([
    {
      id: contentId,
      source: "reddit",
      targetId,
      externalId: "t3_observed",
      kind: "post",
      title: "Observed post",
      permalink: "/r/datascience/comments/observed",
      createdAtSource: "2026-04-10T11:00:00.000Z",
      firstSeenAt: "2026-04-10T11:00:00.000Z",
      lastSeenAt: "2026-04-10T11:00:00.000Z",
    },
  ]);

  await metricsSnapshotRepository.appendMany([
    {
      snapshotAt: "2026-04-10T10:00:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "subscribers",
      metricValue: 12_000,
      collectionJobId: stableUuidFromString("job:about:observed:1"),
    },
    {
      snapshotAt: "2026-04-10T10:00:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "active_users",
      metricValue: 500,
      collectionJobId: stableUuidFromString("job:about:observed:2"),
    },
    {
      snapshotAt: "2026-04-11T00:15:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "new_posts_15m",
      metricValue: 0,
      collectionJobId: stableUuidFromString("job:new-posts:observed-zero"),
    },
  ]);
  await postEngagementRepository.upsertLatestMany([
    {
      contentId,
      targetId,
      source: "reddit",
      observedAt: "2026-04-10T12:05:00.000Z",
      score: 10,
      numComments: 2,
      collectionJobId: stableUuidFromString("job:engagement:observed"),
    },
  ]);

  const facts = await buildSubredditDailyFactsJob(
    {
      contentRepository,
      metricsSnapshotRepository,
      postEngagementRepository,
      subredditDailyFactRepository,
    },
    {
      targetId,
      fromIso: "2026-04-10T00:00:00.000Z",
      toIso: "2026-04-11T23:59:59.000Z",
    },
  );

  assert.deepEqual(
    facts.map((fact) => fact.day),
    ["2026-04-10", "2026-04-11"],
  );
  assert.equal(facts[1]?.postVolume, 0);
  assert.equal(facts[1]?.sampledPostVolume, 0);
  assert.equal(facts[1]?.heatPrice, 0);
  assert.equal(subredditDailyFactRepository.all().length, 2);
});

test("buildSubredditDailyFactsJob excludes discovery-only posts from post volume", async () => {
  const targetId = stableUuidFromString("reddit:target:r/datascience:provenance");
  const totalPostId = stableUuidFromString("reddit:content:t3_total");
  const supplementPostId = stableUuidFromString("reddit:content:t3_supplement");
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
  const subredditDailyFactRepository = new InMemorySubredditDailyFactRepository();

  await contentRepository.upsertMany([
    {
      id: totalPostId,
      source: "reddit",
      targetId,
      externalId: "t3_total",
      kind: "post",
      title: "New listing post",
      permalink: "/r/datascience/comments/total",
      createdAtSource: "2026-04-10T11:00:00.000Z",
      firstSeenAt: "2026-04-10T11:00:00.000Z",
      lastSeenAt: "2026-04-10T11:00:00.000Z",
      discoverySource: "new_listing",
      firstListing: "new",
      totalEligible: true,
    },
    {
      id: supplementPostId,
      source: "reddit",
      targetId,
      externalId: "t3_supplement",
      kind: "post",
      title: "Top supplement post",
      permalink: "/r/datascience/comments/supplement",
      createdAtSource: "2026-04-10T12:00:00.000Z",
      firstSeenAt: "2026-04-10T12:00:00.000Z",
      lastSeenAt: "2026-04-10T12:00:00.000Z",
      discoverySource: "top_supplement",
      firstListing: "top",
      firstTimeRange: "week",
      totalEligible: false,
    },
  ]);

  await metricsSnapshotRepository.appendMany([
    {
      snapshotAt: "2026-04-10T10:00:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "subscribers",
      metricValue: 12_000,
      collectionJobId: stableUuidFromString("job:about:provenance"),
    },
  ]);
  await postEngagementRepository.upsertLatestMany([
    {
      contentId: totalPostId,
      targetId,
      source: "reddit",
      observedAt: "2026-04-10T12:05:00.000Z",
      score: 20,
      numComments: 8,
      collectionJobId: stableUuidFromString("job:engagement:total"),
    },
    {
      contentId: supplementPostId,
      targetId,
      source: "reddit",
      observedAt: "2026-04-10T12:05:00.000Z",
      score: 500,
      numComments: 200,
      collectionJobId: stableUuidFromString("job:engagement:supplement"),
    },
  ]);

  const facts = await buildSubredditDailyFactsJob(
    {
      contentRepository,
      metricsSnapshotRepository,
      postEngagementRepository,
      subredditDailyFactRepository,
    },
    {
      targetId,
      fromIso: "2026-04-10T00:00:00.000Z",
      toIso: "2026-04-10T23:59:59.000Z",
    },
  );

  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.postVolume, 1);
  assert.equal(facts[0]?.scoreSum, 20);
  assert.equal(facts[0]?.commentSum, 8);
});

test("buildSubredditDailyFactsJob backfills earliest known about snapshot across earlier observed days", async () => {
  const targetId = stableUuidFromString("reddit:target:r/overwatch:about-backfill");
  const contentId = stableUuidFromString("reddit:content:t3_about_backfill");
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
  const subredditDailyFactRepository = new InMemorySubredditDailyFactRepository();

  await contentRepository.upsertMany([
    {
      id: contentId,
      source: "reddit",
      targetId,
      externalId: "t3_about_backfill",
      kind: "post",
      title: "Older observed post",
      permalink: "/r/overwatch/comments/about-backfill",
      createdAtSource: "2026-04-10T11:00:00.000Z",
      firstSeenAt: "2026-04-10T11:00:00.000Z",
      lastSeenAt: "2026-04-10T11:00:00.000Z",
    },
  ]);

  await metricsSnapshotRepository.appendMany([
    {
      snapshotAt: "2026-04-11T10:00:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "subscribers",
      metricValue: 2_500_000,
      collectionJobId: stableUuidFromString("job:about:backfill:1"),
    },
    {
      snapshotAt: "2026-04-11T10:00:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "active_users",
      metricValue: 75_000,
      collectionJobId: stableUuidFromString("job:about:backfill:2"),
    },
  ]);
  await postEngagementRepository.upsertLatestMany([
    {
      contentId,
      targetId,
      source: "reddit",
      observedAt: "2026-04-10T12:05:00.000Z",
      score: 50,
      numComments: 20,
      collectionJobId: stableUuidFromString("job:engagement:about-backfill"),
    },
  ]);

  const facts = await buildSubredditDailyFactsJob(
    {
      contentRepository,
      metricsSnapshotRepository,
      postEngagementRepository,
      subredditDailyFactRepository,
    },
    {
      targetId,
      fromIso: "2026-04-10T00:00:00.000Z",
      toIso: "2026-04-11T23:59:59.000Z",
    },
  );

  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.day, "2026-04-10");
  assert.equal(facts[0]?.subscriberCount, 2_500_000);
  assert.equal(facts[0]?.activeUserCount, 75_000);
  assert.equal(facts[0]?.subredditTier, "large");
  assert.equal(facts[0]?.explainPayload.aboutSnapshotCarryMode, "historical_backfill");
});

test("buildSubredditDailyFactsJob zeros heat for unsampled observed days", async () => {
  const targetId = stableUuidFromString("reddit:target:r/overwatch:unsampled-heat");
  const contentId = stableUuidFromString("reddit:content:t3_unsampled_heat");
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
  const subredditDailyFactRepository = new InMemorySubredditDailyFactRepository();

  await contentRepository.upsertMany([
    {
      id: contentId,
      source: "reddit",
      targetId,
      externalId: "t3_unsampled_heat",
      kind: "post",
      title: "Unsampled observed post",
      permalink: "/r/overwatch/comments/unsampled-heat",
      createdAtSource: "2026-04-10T11:00:00.000Z",
      firstSeenAt: "2026-04-10T11:00:00.000Z",
      lastSeenAt: "2026-04-10T11:00:00.000Z",
    },
  ]);

  await metricsSnapshotRepository.appendMany([
    {
      snapshotAt: "2026-04-10T10:00:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "subscribers",
      metricValue: 1_500_000,
      collectionJobId: stableUuidFromString("job:about:unsampled:1"),
    },
    {
      snapshotAt: "2026-04-10T10:00:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "active_users",
      metricValue: 50_000,
      collectionJobId: stableUuidFromString("job:about:unsampled:2"),
    },
  ]);

  const facts = await buildSubredditDailyFactsJob(
    {
      contentRepository,
      metricsSnapshotRepository,
      postEngagementRepository,
      subredditDailyFactRepository,
    },
    {
      targetId,
      fromIso: "2026-04-10T00:00:00.000Z",
      toIso: "2026-04-10T23:59:59.000Z",
    },
  );

  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.postVolume, 1);
  assert.equal(facts[0]?.sampledPostVolume, 0);
  assert.equal(facts[0]?.heatPrice, 0);
  assert.equal(facts[0]?.explainPayload.unsampledObservedDay, true);
});
