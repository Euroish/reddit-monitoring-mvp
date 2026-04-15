import test from "node:test";
import assert from "node:assert/strict";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { DefaultRedditMapper } from "../../src/connectors/reddit/reddit.mapper";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryAccountRepository,
  InMemoryCollectionJobRepository,
  InMemoryContentRepository,
  InMemoryMetricsSnapshotRepository,
  InMemoryMonitorTargetRepository,
  InMemoryRawEventRepository,
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
  const subredditTrendPointRepository = new InMemorySubredditTrendPointRepository();

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

  await runRedditPhase1Cycle(
    {
      monitorTargetRepository,
      collectionJobRepository,
      rawEventRepository,
      accountRepository,
      contentRepository,
      metricsSnapshotRepository,
      subredditTrendPointRepository,
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
  assert.equal(subredditTrendPointRepository.all().length, 1);
});
