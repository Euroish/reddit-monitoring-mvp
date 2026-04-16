import assert from "node:assert/strict";
import test from "node:test";
import type { RedditConnector } from "../../src/connectors/reddit/reddit-connector.interface";
import type { ConnectorPage } from "../../src/connectors/shared/connector.interface";
import type { ConnectorRequestContext } from "../../src/connectors/shared/connector.interface";
import type {
  RedditAboutPayload,
  RedditCollectSubredditAboutArgs,
  RedditCollectSubredditPostsArgs,
  RedditListingPayload,
  RedditPostData,
} from "../../src/connectors/reddit/reddit.types";
import { DefaultRedditMapper } from "../../src/connectors/reddit/reddit.mapper";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryAccountRepository,
  InMemoryCollectionJobRepository,
  InMemoryContentRepository,
  InMemoryCrawlCursorRepository,
  InMemoryMetricsSnapshotRepository,
  InMemoryMonitorTargetRepository,
  InMemoryProviderHealthWindowRepository,
  InMemoryRawEventRepository,
  InMemorySubredditTrendPointRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";
import { executeRunnableCollectionJobs } from "../../workers/reddit-phase1-scheduler";

class RunnableJobConnector implements RedditConnector {
  public readonly sourceCode = "reddit" as const;
  public callCount = 0;

  constructor(private readonly provider: "http" | "scrapling" = "http") {}

  public async collectSubredditAbout(
    _args: RedditCollectSubredditAboutArgs,
    _ctx: ConnectorRequestContext,
  ): Promise<never> {
    throw new Error("not implemented");
  }

  public async collectSubredditPosts(
    args: RedditCollectSubredditPostsArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditListingPayload<RedditPostData>>> {
    this.callCount += 1;
    return {
      raw: {
        endpoint: `/r/${args.subreddit}/new.json`,
        requestParams: {
          limit: args.limit,
          after: args.after,
        },
        httpStatus: 200,
        responseHeaders: {
          "x-provider": this.provider,
        },
        payload: {
          data: {
            after: "t3_cursor_2",
            children: [
              {
                kind: "t3",
                data: {
                  name: "t3_second",
                  id: "second",
                  subreddit: args.subreddit,
                  author: "alice",
                  title: "Second backfill page item",
                  permalink: `/r/${args.subreddit}/comments/second/post`,
                  created_utc: 1_712_751_900,
                  score: 42,
                  num_comments: 6,
                },
              },
            ],
          },
        },
        fetchedAt: ctx.now,
      },
      nextCursor: "t3_cursor_2",
    };
  }

  public async collect(
    args: RedditCollectSubredditPostsArgs,
    ctx: ConnectorRequestContext,
  ) {
    return this.collectSubredditPosts(args, ctx);
  }

  public async healthCheck(): Promise<boolean> {
    return true;
  }
}

test("executeRunnableCollectionJobs preserves backfill cursor and provider health dependencies", async () => {
  const nowIso = "2026-04-12T12:16:00.000Z";
  const targetId = stableUuidFromString("reddit:target:r/machinelearning");
  const monitorTargetRepository = new InMemoryMonitorTargetRepository();
  await monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/machinelearning",
    status: "active",
    config: {},
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const collectionJobRepository = new InMemoryCollectionJobRepository();
  await collectionJobRepository.create({
    id: stableUuidFromString("job:retrying:backfill"),
    source: "reddit",
    targetId,
    jobType: "collect_subreddit_new_posts",
    crawlMode: "backfill",
    status: "retrying",
    scheduledAt: "2026-04-12T12:00:00.000Z",
    nextRunAt: "2026-04-12T12:15:00.000Z",
    dedupeKey: "retrying-backfill",
    retryCount: 1,
    cursor: "t3_cursor_1",
  });

  const crawlCursorRepository = new InMemoryCrawlCursorRepository();
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();

  const executed = await executeRunnableCollectionJobs({
    repos: {
      collectionJobRepository,
      monitorTargetRepository,
      rawEventRepository: new InMemoryRawEventRepository(),
      accountRepository: new InMemoryAccountRepository(),
      contentRepository: new InMemoryContentRepository(),
      crawlCursorRepository,
      providerHealthWindowRepository,
      metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
      subredditTrendPointRepository: new InMemorySubredditTrendPointRepository(),
    },
    connector: new RunnableJobConnector(),
    redditMapper: new DefaultRedditMapper(),
    nowIso,
    runnableJobLimit: 10,
    runMode: "live",
  });

  assert.equal(executed.executedJobs, 1);
  assert.deepEqual(executed.touchedTargets, [
    {
      targetId,
      canonicalName: "r/machinelearning",
      crawlMode: "backfill",
    },
  ]);
  const crawlCursor = await crawlCursorRepository.resolve({
    provider: "http",
    targetId,
    mode: "backfill",
  });
  assert.equal(crawlCursor?.cursor, "t3_cursor_2");
  assert.equal(crawlCursor?.rewindCursor, "t3_cursor_1");

  const providerRows = providerHealthWindowRepository.all();
  assert.equal(providerRows.length, 1);
  assert.equal(providerRows[0]?.requestCount, 1);
  assert.equal(providerRows[0]?.successCount, 1);
});

test("executeRunnableCollectionJobs resolves provider connector from job payload hint", async () => {
  const nowIso = "2026-04-12T12:18:00.000Z";
  const targetId = stableUuidFromString("reddit:target:r/datascience");
  const monitorTargetRepository = new InMemoryMonitorTargetRepository();
  await monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/datascience",
    status: "active",
    config: {},
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const collectionJobRepository = new InMemoryCollectionJobRepository();
  await collectionJobRepository.create({
    id: stableUuidFromString("job:retrying:scrapling"),
    source: "reddit",
    targetId,
    jobType: "collect_subreddit_new_posts",
    crawlMode: "live",
    payload: {
      providerHint: "scrapling",
    },
    status: "retrying",
    scheduledAt: "2026-04-12T12:05:00.000Z",
    nextRunAt: "2026-04-12T12:15:00.000Z",
    dedupeKey: "retrying-scrapling",
    retryCount: 1,
    cursor: undefined,
  });

  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();
  const defaultConnector = new RunnableJobConnector("http");
  const scraplingConnector = new RunnableJobConnector("scrapling");
  await executeRunnableCollectionJobs({
    repos: {
      collectionJobRepository,
      monitorTargetRepository,
      rawEventRepository: new InMemoryRawEventRepository(),
      accountRepository: new InMemoryAccountRepository(),
      contentRepository: new InMemoryContentRepository(),
      crawlCursorRepository: new InMemoryCrawlCursorRepository(),
      providerHealthWindowRepository,
      metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
      subredditTrendPointRepository: new InMemorySubredditTrendPointRepository(),
    },
    connector: defaultConnector,
    connectorResolver: (providerHint) =>
      providerHint === "scrapling" ? scraplingConnector : defaultConnector,
    redditMapper: new DefaultRedditMapper(),
    nowIso,
    runnableJobLimit: 10,
    runMode: "live",
  });

  assert.equal(defaultConnector.callCount, 0);
  assert.equal(scraplingConnector.callCount, 1);
  const providerRows = providerHealthWindowRepository.all();
  assert.equal(providerRows.length, 1);
  assert.equal(providerRows[0]?.provider, "scrapling");
});
