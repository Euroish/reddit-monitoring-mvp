import test from "node:test";
import assert from "node:assert/strict";
import { DefaultRedditMapper } from "../../src/connectors/reddit/reddit.mapper";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import type { ConnectorRequestContext } from "../../src/connectors/shared/connector.interface";
import type {
  RedditCollectSubredditAboutArgs,
  RedditCollectSubredditPostsArgs,
} from "../../src/connectors/reddit/reddit.types";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryAccountRepository,
  InMemoryCollectionJobRepository,
  InMemoryContentRepository,
  InMemoryMetricsSnapshotRepository,
  InMemoryMonitorTargetRepository,
  InMemoryRawEventRepository,
  InMemorySubredditDailyFactRepository,
  InMemorySubredditTrendPointRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";
import { runRedditPhase1Cycle } from "../../src/workers/reddit-phase1.worker";

class SelectiveFailingConnector extends RedditMockConnector {
  public override async collectSubredditAbout(
    args: RedditCollectSubredditAboutArgs,
    ctx: ConnectorRequestContext,
  ) {
    if (args.subreddit === "machinelearning") {
      throw new Error("simulated subreddit failure");
    }
    return super.collectSubredditAbout(args, ctx);
  }

  public override async collectSubredditPosts(
    args: RedditCollectSubredditPostsArgs,
    ctx: ConnectorRequestContext,
  ) {
    return super.collectSubredditPosts(args, ctx);
  }
}

test("phase1 cycle can continue processing other targets when one target fails", async () => {
  const nowIso = "2026-04-10T12:00:00.000Z";

  const monitorTargetRepository = new InMemoryMonitorTargetRepository();
  const collectionJobRepository = new InMemoryCollectionJobRepository();
  const rawEventRepository = new InMemoryRawEventRepository();
  const accountRepository = new InMemoryAccountRepository();
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const subredditDailyFactRepository = new InMemorySubredditDailyFactRepository();
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
      subredditDailyFactRepository,
      subredditTrendPointRepository,
      redditConnector: new SelectiveFailingConnector(),
      redditMapper: new DefaultRedditMapper(),
    },
    nowIso,
    {
      continueOnError: true,
    },
  );

  assert.deepEqual(result.processedCanonicalNames, ["r/datascience"]);
  assert.equal(result.failedTargets.length, 1);
  assert.equal(result.failedTargets[0]?.canonicalName, "r/machinelearning");
  assert.equal(contentRepository.all().length > 0, true);
});
