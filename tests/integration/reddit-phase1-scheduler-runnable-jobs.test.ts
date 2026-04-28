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
  InMemorySubredditDailyFactRepository,
  InMemorySubredditTrendPointRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";
import {
  executeRunnableCollectionJobs,
  maybeRunScheduledRetentionPrune,
  resolveSchedulerLiveProviderExecutionPlan,
  resolveSchedulerRunnableProviderHint,
} from "../../workers/reddit-phase1-scheduler";

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
      subredditDailyFactRepository: new InMemorySubredditDailyFactRepository(),
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
      subredditDailyFactRepository: new InMemorySubredditDailyFactRepository(),
      subredditTrendPointRepository: new InMemorySubredditTrendPointRepository(),
    },
    connector: defaultConnector,
    connectorResolver: ({ providerHint }) =>
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

test("resolveSchedulerRunnableProviderHint reroutes live jobs from failed http to scrapling fallback", () => {
  assert.equal(
    resolveSchedulerRunnableProviderHint({
      providerHint: undefined,
      crawlMode: "live",
      configuredProvider: "http",
      effectiveProvider: "scrapling",
    }),
    "scrapling",
  );
  assert.equal(
    resolveSchedulerRunnableProviderHint({
      providerHint: "http",
      crawlMode: "live",
      configuredProvider: "http",
      effectiveProvider: "scrapling",
    }),
    "scrapling",
  );
  assert.equal(
    resolveSchedulerRunnableProviderHint({
      providerHint: "scrapling",
      crawlMode: "live",
      configuredProvider: "http",
      effectiveProvider: "scrapling",
    }),
    "scrapling",
  );
  assert.equal(
    resolveSchedulerRunnableProviderHint({
      providerHint: "http",
      crawlMode: "backfill",
      configuredProvider: "http",
      effectiveProvider: "scrapling",
    }),
    "http",
  );
});

test("maybeRunScheduledRetentionPrune runs on first eligible cycle and respects interval gating", async () => {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  const db = {
    async query<T extends { id?: number }>(text: string, params?: unknown[]) {
      calls.push({ text, params });
      const rowCount = calls.length <= 2 ? 1 : 0;
      return {
        command: "DELETE",
        rowCount,
        oid: 0,
        fields: [],
        rows: Array.from({ length: rowCount }, (_, index) => ({ id: index + 1 })) as T[],
      } as unknown as import("pg").QueryResult<T>;
    },
  };

  const first = await maybeRunScheduledRetentionPrune({
    db,
    env: {
      REDDIT_RETENTION_PRUNE_INTERVAL_MINUTES: "60",
      RAW_EVENT_PRUNE_BATCH_SIZE: "10",
      METRICS_SNAPSHOT_PRUNE_BATCH_SIZE: "10",
    },
    nowIso: "2026-04-12T12:00:00.000Z",
  });
  assert.equal(first.ran, true);
  assert.deepEqual(first.result, {
    rawEventsDeleted: 1,
    metricsSnapshotsDeleted: 1,
    postEngagementWindowsDeleted: 0,
  });

  const skipped = await maybeRunScheduledRetentionPrune({
    db,
    env: {
      REDDIT_RETENTION_PRUNE_INTERVAL_MINUTES: "60",
    },
    nowIso: "2026-04-12T12:30:00.000Z",
    lastRunAtIso: "2026-04-12T12:00:00.000Z",
  });
  assert.deepEqual(skipped, { ran: false });

  const second = await maybeRunScheduledRetentionPrune({
    db,
    env: {
      REDDIT_RETENTION_PRUNE_INTERVAL_MINUTES: "60",
    },
    nowIso: "2026-04-12T13:05:00.000Z",
    lastRunAtIso: "2026-04-12T12:00:00.000Z",
  });
  assert.equal(second.ran, true);
  assert.deepEqual(second.result, {
    rawEventsDeleted: 0,
    metricsSnapshotsDeleted: 0,
    postEngagementWindowsDeleted: 0,
  });
  assert.equal(calls.length, 6);
});

class AboutProbeConnector implements RedditConnector {
  public readonly sourceCode = "reddit" as const;

  constructor(private readonly aboutStatus: 200 | 403) {}

  public async collectSubredditAbout(
    args: RedditCollectSubredditAboutArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditAboutPayload>> {
    return {
      raw: {
        endpoint: `/r/${args.subreddit}/about.json`,
        requestParams: {},
        httpStatus: this.aboutStatus,
        responseHeaders: {},
        payload: {
          data: {
            display_name: args.subreddit,
            name: `t5_${args.subreddit}`,
            subscribers: 1,
            accounts_active: 1,
          },
        },
        fetchedAt: ctx.now,
      },
    };
  }

  public async collectSubredditPosts(
    _args: RedditCollectSubredditPostsArgs,
    _ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditListingPayload<RedditPostData>>> {
    throw new Error("not implemented");
  }

  public async collect(
    args: RedditCollectSubredditPostsArgs,
    ctx: ConnectorRequestContext,
  ) {
    return this.collectSubredditPosts(args, ctx);
  }

  public async healthCheck(): Promise<boolean> {
    return this.aboutStatus === 200;
  }
}

test("resolveSchedulerLiveProviderExecutionPlan promotes live lane to scrapling when http capability fails", async () => {
  const plan = await resolveSchedulerLiveProviderExecutionPlan({
    runMode: "live",
    providerCapability: {
      required: true,
      provider: "http",
      subreddit: "askreddit",
    },
    nowIso: "2026-04-23T03:00:00.000Z",
    resolveConnectorForProviderHint: (providerHint) =>
      providerHint === "scrapling"
        ? new AboutProbeConnector(200)
        : new AboutProbeConnector(403),
  });

  assert.equal(plan.blocked, false);
  assert.equal(plan.configuredProvider, "http");
  assert.equal(plan.effectiveProvider, "scrapling");
  assert.equal(plan.fallbackProvider, "scrapling");
  assert.match(plan.primaryReason ?? "", /unexpected_http_status:403/);
});

test("resolveSchedulerLiveProviderExecutionPlan blocks immediately on Reddit network policy failure", async () => {
  let scraplingProbeAttempts = 0;
  const plan = await resolveSchedulerLiveProviderExecutionPlan({
    runMode: "live",
    providerCapability: {
      required: true,
      provider: "http",
      subreddit: "askreddit",
    },
    nowIso: "2026-04-23T03:00:00.000Z",
    resolveConnectorForProviderHint: (providerHint) => {
      if (providerHint === "scrapling") {
        scraplingProbeAttempts += 1;
      }
      return providerHint === "http"
        ? {
            sourceCode: "reddit" as const,
            async collectSubredditAbout() {
              throw new Error(
                "Reddit request failed: status=403, endpoint=/r/askreddit/about.json, body=<html><body>You've been blocked by network security. use your developer token</body></html>",
              );
            },
            async collectSubredditPosts() {
              throw new Error("not implemented");
            },
            async collect(args, ctx) {
              return this.collectSubredditPosts(args, ctx);
            },
            async healthCheck() {
              return false;
            },
          }
        : new AboutProbeConnector(200);
    },
  });

  assert.equal(plan.blocked, true);
  assert.equal(plan.effectiveProvider, "http");
  assert.equal(plan.primaryFailureCategory, "network_policy_block");
  assert.equal(plan.fallbackProvider, undefined);
  assert.equal(scraplingProbeAttempts, 0);
});
