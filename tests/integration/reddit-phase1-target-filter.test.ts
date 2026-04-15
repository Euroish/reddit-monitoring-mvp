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

test("phase1 cycle can run only requested target canonical names", async () => {
  const nowIso = "2026-04-10T12:00:00.000Z";
  const monitorTargetRepository = new InMemoryMonitorTargetRepository();
  const collectionJobRepository = new InMemoryCollectionJobRepository();
  const rawEventRepository = new InMemoryRawEventRepository();
  const accountRepository = new InMemoryAccountRepository();
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const subredditTrendPointRepository = new InMemorySubredditTrendPointRepository();

  for (const subreddit of ["machinelearning", "datascience"]) {
    await monitorTargetRepository.upsert({
      id: stableUuidFromString(`reddit:target:r/${subreddit}`),
      source: "reddit",
      targetType: "subreddit",
      canonicalName: `r/${subreddit}`,
      status: "active",
      config: {},
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  const result = await runRedditPhase1Cycle(
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
    { targetCanonicalNames: ["r/datascience"] },
  );

  assert.deepEqual(result.requestedCanonicalNames, ["r/datascience"]);
  assert.deepEqual(result.processedCanonicalNames, ["r/datascience"]);
  assert.equal(collectionJobRepository.all().length, 2);
  assert.equal(rawEventRepository.all().length, 2);

  const uniqueTargetIds = new Set(contentRepository.all().map((item) => item.targetId));
  assert.equal(uniqueTargetIds.size, 1);
  assert.equal(uniqueTargetIds.has(stableUuidFromString("reddit:target:r/datascience")), true);
});
