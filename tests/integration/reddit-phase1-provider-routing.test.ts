import assert from "node:assert/strict";
import test from "node:test";
import type { RedditConnector } from "../../src/connectors/reddit/reddit-connector.interface";
import type { ConnectorPage, ConnectorRequestContext } from "../../src/connectors/shared/connector.interface";
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
import { createRedditFetchExecutionEngine } from "../../src/runtime/reddit-fetch-execution-engine";
import { resolveRedditProviderRoutingPolicyContextFromEnv } from "../../src/runtime/reddit-provider-routing-policy";
import { runRedditPhase1Cycle } from "../../src/workers/reddit-phase1.worker";

class ProviderTaggedConnector implements RedditConnector {
  public readonly sourceCode = "reddit" as const;
  public readonly postCalls: string[] = [];

  constructor(private readonly provider: "http" | "scrapling") {}

  public async collect(
    args: RedditCollectSubredditPostsArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditListingPayload<RedditPostData>>> {
    return this.collectSubredditPosts(args, ctx);
  }

  public async collectSubredditAbout(
    args: RedditCollectSubredditAboutArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditAboutPayload>> {
    return {
      raw: {
        endpoint: `/r/${args.subreddit}/about.json`,
        requestParams: {},
        httpStatus: 200,
        responseHeaders: {
          "x-provider": this.provider,
        },
        payload: {
          data: {
            display_name: args.subreddit,
            name: `t5_${args.subreddit}`,
            subscribers: 1000,
            accounts_active: 100,
          },
        },
        fetchedAt: ctx.now,
      },
    };
  }

  public async collectSubredditPosts(
    args: RedditCollectSubredditPostsArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditListingPayload<RedditPostData>>> {
    this.postCalls.push(args.subreddit);
    const nowSec = Math.floor(new Date(ctx.now).getTime() / 1000);
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
            after: undefined,
            children: [
              {
                kind: "t3",
                data: {
                  name: `t3_${this.provider}_${args.subreddit}`,
                  id: `${this.provider}_${args.subreddit}`,
                  subreddit: args.subreddit,
                  author: `${this.provider}_author`,
                  title: `${this.provider} post`,
                  permalink: `/r/${args.subreddit}/comments/${this.provider}_${args.subreddit}`,
                  created_utc: nowSec - 30,
                  score: 10,
                  num_comments: 2,
                },
              },
            ],
          },
        },
        fetchedAt: ctx.now,
      },
      nextCursor: undefined,
    };
  }

  public async healthCheck(): Promise<boolean> {
    return true;
  }
}

test("phase1 cycle routes promoted targets to scrapling while keeping others on http", async () => {
  const nowIso = "2026-04-16T06:00:00.000Z";
  const monitorTargetRepository = new InMemoryMonitorTargetRepository();
  const collectionJobRepository = new InMemoryCollectionJobRepository();
  const rawEventRepository = new InMemoryRawEventRepository();
  const accountRepository = new InMemoryAccountRepository();
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const subredditDailyFactRepository = new InMemorySubredditDailyFactRepository();
  const subredditTrendPointRepository = new InMemorySubredditTrendPointRepository();
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();

  for (const canonicalName of ["r/machinelearning", "r/datascience"]) {
    await monitorTargetRepository.upsert({
      id: stableUuidFromString(`reddit:target:${canonicalName}`),
      source: "reddit",
      targetType: "subreddit",
      canonicalName,
      status: "active",
      config: {},
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  const httpConnector = new ProviderTaggedConnector("http");
  const scraplingConnector = new ProviderTaggedConnector("scrapling");

  await runRedditPhase1Cycle(
    {
      monitorTargetRepository,
      collectionJobRepository,
      rawEventRepository,
      accountRepository,
      contentRepository,
      providerHealthWindowRepository,
      metricsSnapshotRepository,
      subredditDailyFactRepository,
      subredditTrendPointRepository,
      redditConnector: httpConnector,
      redditConnectorResolver: ({ providerHint }) =>
        providerHint === "scrapling" ? scraplingConnector : httpConnector,
      redditMapper: new DefaultRedditMapper(),
    },
    nowIso,
    {
      targetCanonicalNames: ["r/machinelearning", "r/datascience"],
      providerHint: "http",
      scraplingPrimaryCanonicalNames: ["r/datascience"],
      disableAdaptiveSampling: true,
      basePostLimit: 5,
      boostPostLimit: 5,
    },
  );

  assert.deepEqual(httpConnector.postCalls, ["machinelearning"]);
  assert.deepEqual(scraplingConnector.postCalls, ["datascience"]);

  const providerRows = providerHealthWindowRepository.all().sort((a, b) =>
    a.provider.localeCompare(b.provider),
  );
  assert.equal(providerRows.length, 2);
  assert.equal(providerRows[0]?.provider, "http");
  assert.equal(providerRows[0]?.targetId, stableUuidFromString("reddit:target:r/machinelearning"));
  assert.equal(providerRows[1]?.provider, "scrapling");
  assert.equal(providerRows[1]?.targetId, stableUuidFromString("reddit:target:r/datascience"));
});

test("phase1 cycle falls promoted scrapling targets back to http when persisted truth marks scrapling degraded", async () => {
  const nowIso = "2026-04-16T06:10:00.000Z";
  const monitorTargetRepository = new InMemoryMonitorTargetRepository();
  const collectionJobRepository = new InMemoryCollectionJobRepository();
  const rawEventRepository = new InMemoryRawEventRepository();
  const accountRepository = new InMemoryAccountRepository();
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const subredditDailyFactRepository = new InMemorySubredditDailyFactRepository();
  const subredditTrendPointRepository = new InMemorySubredditTrendPointRepository();
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();
  const canonicalName = "r/datascience";
  const targetId = stableUuidFromString(`reddit:target:${canonicalName}`);

  await monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName,
    status: "active",
    config: {},
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  await providerHealthWindowRepository.record({
    provider: "scrapling",
    targetId,
    mode: "live",
    windowStart: "2026-04-16T05:55:00.000Z",
    requestCountDelta: 10,
    successCountDelta: 8,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 24,
    acceptedCountDelta: 24,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 0,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 2,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 2,
    circuitOpenCountDelta: 0,
    updatedAt: nowIso,
  });
  await crawlCursorRepository.upsert({
    provider: "scrapling",
    targetId,
    mode: "live",
    cursor: "t3_scrapling_cursor",
    lastFetchedAt: "2026-04-16T05:50:00.000Z",
    updatedAt: "2026-04-16T05:50:00.000Z",
  });

  const httpConnector = new ProviderTaggedConnector("http");
  const scraplingConnector = new ProviderTaggedConnector("scrapling");
  const executionEngine = createRedditFetchExecutionEngine({
    mode: "live",
    createConnector: (_mode, _crawlMode, providerOverride) =>
      providerOverride === "scrapling" ? scraplingConnector : httpConnector,
    providerHealthWindowRepository,
    crawlCursorRepository,
    policyContext: resolveRedditProviderRoutingPolicyContextFromEnv({
      REDDIT_LIVE_PROVIDER: "http",
      REDDIT_SCRAPLING_PROFILE: "http",
      REDDIT_SCRAPLING_PRIMARY_SUBREDDITS: "datascience",
    }),
  });

  await runRedditPhase1Cycle(
    {
      monitorTargetRepository,
      collectionJobRepository,
      rawEventRepository,
      accountRepository,
      contentRepository,
      crawlCursorRepository,
      providerHealthWindowRepository,
      metricsSnapshotRepository,
      subredditDailyFactRepository,
      subredditTrendPointRepository,
      redditConnector: httpConnector,
      redditExecutionStrategyResolver: ({
        targetId: executionTargetId,
        canonicalName: executionCanonicalName,
        providerHint,
        crawlMode,
        nowIso: executionNowIso,
      }) =>
        executionEngine.resolveStrategy({
          targetId: executionTargetId,
          canonicalName: executionCanonicalName,
          defaultProviderHint: providerHint,
          crawlMode,
          nowIso: executionNowIso,
        }),
      redditMapper: new DefaultRedditMapper(),
    },
    nowIso,
    {
      targetCanonicalNames: [canonicalName],
      providerHint: "http",
      scraplingPrimaryCanonicalNames: [canonicalName],
      disableAdaptiveSampling: true,
      basePostLimit: 5,
      boostPostLimit: 5,
    },
  );

  assert.deepEqual(httpConnector.postCalls, ["datascience"]);
  assert.deepEqual(scraplingConnector.postCalls, []);
});

test("phase1 cycle falls promoted scrapling targets back to http when dynamic scrapling still returns stale-head evidence", async () => {
  const nowIso = "2026-04-16T06:20:00.000Z";
  const monitorTargetRepository = new InMemoryMonitorTargetRepository();
  const collectionJobRepository = new InMemoryCollectionJobRepository();
  const rawEventRepository = new InMemoryRawEventRepository();
  const accountRepository = new InMemoryAccountRepository();
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const subredditDailyFactRepository = new InMemorySubredditDailyFactRepository();
  const subredditTrendPointRepository = new InMemorySubredditTrendPointRepository();
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();
  const canonicalName = "r/datascience";
  const targetId = stableUuidFromString(`reddit:target:${canonicalName}`);

  await monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName,
    status: "active",
    config: {},
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  await providerHealthWindowRepository.record({
    provider: "scrapling",
    targetId,
    mode: "live",
    windowStart: "2026-04-16T06:15:00.000Z",
    requestCountDelta: 6,
    successCountDelta: 6,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 60,
    acceptedCountDelta: 60,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 42,
    ingestLagSecondsSumDelta: 48_000,
    ingestLagSampleCountDelta: 6,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    scraplingHttpProfileCountDelta: 1,
    scraplingDynamicProfileCountDelta: 5,
    scraplingSessionKeyCountDelta: 6,
    scraplingSessionKeyReuseCountDelta: 5,
    updatedAt: nowIso,
  });
  await crawlCursorRepository.upsert({
    provider: "scrapling",
    targetId,
    mode: "live",
    cursor: "t3_scrapling_dynamic_cursor",
    lastFetchedAt: "2026-04-16T06:18:00.000Z",
    updatedAt: "2026-04-16T06:18:00.000Z",
  });

  const httpConnector = new ProviderTaggedConnector("http");
  const scraplingConnector = new ProviderTaggedConnector("scrapling");
  const executionEngine = createRedditFetchExecutionEngine({
    mode: "live",
    createConnector: (_mode, _crawlMode, providerOverride) =>
      providerOverride === "scrapling" ? scraplingConnector : httpConnector,
    providerHealthWindowRepository,
    crawlCursorRepository,
    policyContext: resolveRedditProviderRoutingPolicyContextFromEnv({
      REDDIT_LIVE_PROVIDER: "http",
      REDDIT_SCRAPLING_PROFILE: "http",
      REDDIT_SCRAPLING_PRIMARY_SUBREDDITS: "datascience",
    }),
  });

  await runRedditPhase1Cycle(
    {
      monitorTargetRepository,
      collectionJobRepository,
      rawEventRepository,
      accountRepository,
      contentRepository,
      crawlCursorRepository,
      providerHealthWindowRepository,
      metricsSnapshotRepository,
      subredditDailyFactRepository,
      subredditTrendPointRepository,
      redditConnector: httpConnector,
      redditExecutionStrategyResolver: ({
        targetId: executionTargetId,
        canonicalName: executionCanonicalName,
        providerHint,
        crawlMode,
        nowIso: executionNowIso,
      }) =>
        executionEngine.resolveStrategy({
          targetId: executionTargetId,
          canonicalName: executionCanonicalName,
          defaultProviderHint: providerHint,
          crawlMode,
          nowIso: executionNowIso,
        }),
      redditMapper: new DefaultRedditMapper(),
    },
    nowIso,
    {
      targetCanonicalNames: [canonicalName],
      providerHint: "http",
      scraplingPrimaryCanonicalNames: [canonicalName],
      disableAdaptiveSampling: true,
      basePostLimit: 5,
      boostPostLimit: 5,
    },
  );

  assert.deepEqual(httpConnector.postCalls, ["datascience"]);
  assert.deepEqual(scraplingConnector.postCalls, []);
});
