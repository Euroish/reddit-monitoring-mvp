import test from "node:test";
import assert from "node:assert/strict";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { DefaultRedditMapper } from "../../src/connectors/reddit/reddit.mapper";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryAccountRepository,
  InMemoryAnomalyEventRepository,
  InMemoryCollectionJobRepository,
  InMemoryContentRepository,
  InMemoryMetricsSnapshotRepository,
  InMemoryMonitorTargetRepository,
  InMemoryPostGrowthFactRepository,
  InMemoryRawEventRepository,
  InMemorySubredditDailyFactRepository,
  InMemorySubredditTrendPointRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";
import { runRedditPhase1Cycle } from "../../src/workers/reddit-phase1.worker";

test("phase1 cycle writes raw, normalized and trend data", async () => {
  const nowIso = "2026-04-10T12:00:00.000Z";
  const subreddit = "machinelearning";
  const targetId = stableUuidFromString(`reddit:target:r/${subreddit}`);

  const monitorTargetRepository = new InMemoryMonitorTargetRepository();
  const collectionJobRepository = new InMemoryCollectionJobRepository();
  const rawEventRepository = new InMemoryRawEventRepository();
  const accountRepository = new InMemoryAccountRepository();
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const subredditDailyFactRepository = new InMemorySubredditDailyFactRepository();
  const postGrowthFactRepository = new InMemoryPostGrowthFactRepository();
  const subredditTrendPointRepository = new InMemorySubredditTrendPointRepository();
  const anomalyEventRepository = new InMemoryAnomalyEventRepository();

  await monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: `r/${subreddit}`,
    status: "active",
    config: {},
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  await subredditTrendPointRepository.upsertMany([
    {
      targetId,
      windowStart: "2026-04-09T00:00:00.000Z",
      windowEnd: "2026-04-09T06:00:00.000Z",
      granularity: "6h",
      newPosts: 210,
      deltaNewPostsVsPrevWindow: 160,
      deltaActiveUsersVsPrevWindow: 0,
      trendScore: 0.82,
      anomalyScore: 0.9,
      surgeScore: 0.92,
      sampleCount: 1,
      windowComplete: true,
    },
  ]);

  await runRedditPhase1Cycle(
    {
      monitorTargetRepository,
      collectionJobRepository,
      rawEventRepository,
      accountRepository,
      contentRepository,
      metricsSnapshotRepository,
      subredditDailyFactRepository,
      postGrowthFactRepository,
      subredditTrendPointRepository,
      anomalyEventRepository,
      redditConnector: new RedditMockConnector(),
      redditMapper: new DefaultRedditMapper(),
    },
    nowIso,
  );

  assert.equal(collectionJobRepository.all().length, 2);
  assert.equal(rawEventRepository.all().length, 2);
  assert.equal(accountRepository.all().length, 2);
  assert.equal(contentRepository.all().length, 2);
  assert.equal(metricsSnapshotRepository.all().length, 9);
  assert.equal(subredditDailyFactRepository.all().length > 0, true);
  assert.equal(postGrowthFactRepository.all().length > 0, true);
  assert.equal(subredditTrendPointRepository.all().length > 0, true);
  assert.equal(anomalyEventRepository.all().some((row) => row.signalType === "volume"), true);
});
