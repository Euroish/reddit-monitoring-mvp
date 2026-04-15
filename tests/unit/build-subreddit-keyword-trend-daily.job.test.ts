import test from "node:test";
import assert from "node:assert/strict";
import { buildSubredditKeywordTrendDailyJob } from "../../src/jobs/build-subreddit-keyword-trend-daily.job";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryContentRepository,
  InMemoryKeywordTrendDailyRepository,
  InMemoryMetricsSnapshotRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";

test("buildSubredditKeywordTrendDailyJob materializes mention and qualified rates", async () => {
  const targetId = stableUuidFromString("reddit:target:r/datascience");
  const contentAId = stableUuidFromString("reddit:content:t3_a");
  const contentBId = stableUuidFromString("reddit:content:t3_b");
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const keywordTrendDailyRepository = new InMemoryKeywordTrendDailyRepository();

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

  await metricsSnapshotRepository.appendMany([
    {
      snapshotAt: "2026-04-10T12:05:00.000Z",
      source: "reddit",
      targetId,
      contentId: contentAId,
      granularity: "15m",
      metricName: "score",
      metricValue: 25,
      collectionJobId: stableUuidFromString("job:score:a"),
    },
    {
      snapshotAt: "2026-04-10T12:05:00.000Z",
      source: "reddit",
      targetId,
      contentId: contentAId,
      granularity: "15m",
      metricName: "num_comments",
      metricValue: 30,
      collectionJobId: stableUuidFromString("job:comments:a"),
    },
    {
      snapshotAt: "2026-04-10T12:05:00.000Z",
      source: "reddit",
      targetId,
      contentId: contentBId,
      granularity: "15m",
      metricName: "score",
      metricValue: 5,
      collectionJobId: stableUuidFromString("job:score:b"),
    },
    {
      snapshotAt: "2026-04-10T12:05:00.000Z",
      source: "reddit",
      targetId,
      contentId: contentBId,
      granularity: "15m",
      metricName: "num_comments",
      metricValue: 4,
      collectionJobId: stableUuidFromString("job:comments:b"),
    },
  ]);

  const rows = await buildSubredditKeywordTrendDailyJob(
    {
      contentRepository,
      metricsSnapshotRepository,
      keywordTrendDailyRepository,
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
