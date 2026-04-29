import test from "node:test";
import assert from "node:assert/strict";
import type { RedditConnector } from "../../src/connectors/reddit/reddit-connector.interface";
import type { ConnectorPage, ConnectorRequestContext } from "../../src/connectors/shared/connector.interface";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { DefaultRedditMapper } from "../../src/connectors/reddit/reddit.mapper";
import type {
  RedditAboutPayload,
  RedditCollectSubredditAboutArgs,
  RedditCollectSubredditPostsArgs,
  RedditListingPayload,
  RedditPostData,
} from "../../src/connectors/reddit/reddit.types";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryAccountRepository,
  InMemoryAnomalyEventRepository,
  InMemoryCollectionJobRepository,
  InMemoryContentRepository,
  InMemoryCrawlCursorRepository,
  InMemoryMetricsSnapshotRepository,
  InMemoryMonitorTargetRepository,
  InMemoryPostEngagementRepository,
  InMemoryPostGrowthFactRepository,
  InMemoryRawEventRepository,
  InMemorySubredditDailyFactRepository,
  InMemorySubredditTrendPointRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";
import { runRedditPhase1Cycle } from "../../src/workers/reddit-phase1.worker";
import { isFavoriteTargetDueForLiveCollection } from "../../src/workers/reddit-target-scheduling";

class ScriptedBackfillConnector implements RedditConnector {
  public readonly sourceCode = "reddit" as const;
  public readonly seenAfter: Array<string | undefined> = [];
  public readonly seenRequests: RedditCollectSubredditPostsArgs[] = [];
  private callIndex = 0;

  constructor(
    private readonly script: Array<{
      nextCursor?: string;
      posts: RedditPostData[];
    }>,
    private readonly about: {
      subscribers: number;
      accountsActive: number;
    } = {
      subscribers: 1_000_000,
      accountsActive: 50_000,
    },
  ) {}

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
        responseHeaders: {},
        payload: {
          data: {
            display_name: args.subreddit,
            subscribers: this.about.subscribers,
            accounts_active: this.about.accountsActive,
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
    this.seenRequests.push({ ...args });
    const listing = args.listing === "top" ? "top" : "new";
    if (listing === "top") {
      return {
        raw: {
          endpoint: `/r/${args.subreddit}/top.json`,
          requestParams: {
            limit: args.limit,
            after: args.after,
            t: args.timeRange ?? "week",
          },
          httpStatus: 200,
          responseHeaders: {},
          payload: {
            data: {
              after: undefined,
              children: [],
            },
          },
          fetchedAt: ctx.now,
        },
        nextCursor: undefined,
      };
    }

    this.seenAfter.push(args.after);
    const current = this.script[Math.min(this.callIndex, this.script.length - 1)]!;
    this.callIndex += 1;
    return {
      raw: {
        endpoint: `/r/${args.subreddit}/${listing}.json`,
        requestParams: {
          limit: args.limit,
          after: args.after,
          t: undefined,
        },
        httpStatus: 200,
        responseHeaders: {},
        payload: {
          data: {
            after: current.nextCursor,
            children: current.posts.map((post) => ({ kind: "t3", data: post })),
          },
        },
        fetchedAt: ctx.now,
      },
      nextCursor: current.nextCursor,
    };
  }

  public async healthCheck(_ctx: ConnectorRequestContext): Promise<boolean> {
    return true;
  }
}

class TrackingLiveConnector implements RedditConnector {
  public readonly sourceCode = "reddit" as const;
  public readonly seenSubreddits: string[] = [];

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
        responseHeaders: {},
        payload: {
          data: {
            display_name: args.subreddit,
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
    this.seenSubreddits.push(args.subreddit);
    return {
      raw: {
        endpoint: `/r/${args.subreddit}/new.json`,
        requestParams: {
          limit: args.limit,
          after: args.after,
        },
        httpStatus: 200,
        responseHeaders: {},
        payload: {
          data: {
            after: undefined,
            children: [
              {
                kind: "t3",
                data: {
                  name: `t3_${args.subreddit}_0`,
                  id: `${args.subreddit}_0`,
                  subreddit: args.subreddit,
                  author: "alice",
                  title: `${args.subreddit} live post`,
                  permalink: `/r/${args.subreddit}/comments/live/post`,
                  created_utc: Math.floor(new Date(ctx.now).getTime() / 1000),
                  score: 10,
                  num_comments: 2,
                  upvote_ratio: 0.8,
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

function buildBackfillPosts(args: {
  subreddit: string;
  prefix: string;
  count: number;
  baseCreatedUtc: number;
  scoreForIndex?: (index: number) => number;
  commentsForIndex?: (index: number) => number;
}): RedditPostData[] {
  return Array.from({ length: args.count }, (_, index) => ({
    name: `t3_${args.prefix}_${index}`,
    id: `${args.prefix}_${index}`,
    subreddit: args.subreddit,
    author: `user_${index}`,
    title: `${args.prefix} title ${index}`,
    permalink: `/r/${args.subreddit}/comments/${args.prefix}_${index}/post`,
    created_utc: args.baseCreatedUtc + index,
    score: args.scoreForIndex ? args.scoreForIndex(index) : 15 + (index % 5),
    num_comments: args.commentsForIndex ? args.commentsForIndex(index) : 4 + (index % 3),
    upvote_ratio: 0.8,
  }));
}

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
  const postEngagementRepository = new InMemoryPostEngagementRepository();
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
      postEngagementRepository,
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
  assert.equal(metricsSnapshotRepository.all().length, 3);
  assert.equal(postEngagementRepository.allLatest().length, 2);
  assert.equal(postEngagementRepository.allWindows().length, 2);
  assert.equal(subredditDailyFactRepository.all().length > 0, true);
  assert.equal(postGrowthFactRepository.all().length > 0, true);
  assert.equal(subredditTrendPointRepository.all().length > 0, true);
  assert.equal(anomalyEventRepository.all().some((row) => row.signalType === "volume"), true);
});

test("phase1 cycle live mode only processes favorite targets due for the current cadence slot", async () => {
  const nowIso = "2026-04-27T02:20:00.000Z";
  const favoriteConfig = {
    collection: {
      live: {
        favorite: true,
        cadenceHours: 8,
      },
    },
  };
  const candidates = Array.from({ length: 512 }, (_, index) => {
    const canonicalName = `r/favorite-${index}`;
    return {
      id: stableUuidFromString(`reddit:target:${canonicalName}`),
      source: "reddit" as const,
      targetType: "subreddit" as const,
      canonicalName,
      status: "active" as const,
      config: favoriteConfig,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });
  const dueTarget = candidates.find((target) =>
    isFavoriteTargetDueForLiveCollection({
      target,
      nowIso,
    }),
  );
  const laterTarget = candidates.find(
    (target) =>
      !isFavoriteTargetDueForLiveCollection({
        target,
        nowIso,
      }),
  );
  if (!dueTarget || !laterTarget) {
    throw new Error("failed to construct due and non-due favorite targets for cadence test");
  }

  const monitorTargetRepository = new InMemoryMonitorTargetRepository();
  await monitorTargetRepository.upsert(dueTarget);
  await monitorTargetRepository.upsert(laterTarget);

  const connector = new TrackingLiveConnector();
  const result = await runRedditPhase1Cycle(
    {
      monitorTargetRepository,
      collectionJobRepository: new InMemoryCollectionJobRepository(),
      rawEventRepository: new InMemoryRawEventRepository(),
      accountRepository: new InMemoryAccountRepository(),
      contentRepository: new InMemoryContentRepository(),
      metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
      postEngagementRepository: new InMemoryPostEngagementRepository(),
      subredditDailyFactRepository: new InMemorySubredditDailyFactRepository(),
      postGrowthFactRepository: new InMemoryPostGrowthFactRepository(),
      subredditTrendPointRepository: new InMemorySubredditTrendPointRepository(),
      anomalyEventRepository: new InMemoryAnomalyEventRepository(),
      redditConnector: connector,
      redditMapper: new DefaultRedditMapper(),
    },
    nowIso,
    {
      crawlMode: "live",
    },
  );

  assert.deepEqual(result.processedCanonicalNames, [dueTarget.canonicalName]);
  assert.deepEqual(connector.seenSubreddits, [dueTarget.canonicalName.replace(/^r\//, "")]);
});

test("phase1 cycle backfill mode continues across multiple cursor windows until coverage target", async () => {
  const nowIso = "2026-04-24T12:00:00.000Z";
  const subreddit = "worldnews";
  const targetId = stableUuidFromString(`reddit:target:r/${subreddit}`);

  const monitorTargetRepository = new InMemoryMonitorTargetRepository();
  const collectionJobRepository = new InMemoryCollectionJobRepository();
  const rawEventRepository = new InMemoryRawEventRepository();
  const accountRepository = new InMemoryAccountRepository();
  const contentRepository = new InMemoryContentRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
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

  const connector = new ScriptedBackfillConnector([
    {
      nextCursor: "t3_cursor_1",
      posts: buildBackfillPosts({
        subreddit,
        prefix: "page1",
        count: 3,
        baseCreatedUtc: Math.floor(Date.parse("2026-04-24T10:00:00.000Z") / 1000),
      }),
    },
    {
      nextCursor: "t3_cursor_2",
      posts: buildBackfillPosts({
        subreddit,
        prefix: "page2",
        count: 3,
        baseCreatedUtc: Math.floor(Date.parse("2026-04-18T10:00:00.000Z") / 1000),
      }),
    },
    {
      posts: buildBackfillPosts({
        subreddit,
        prefix: "page3",
        count: 3,
        baseCreatedUtc: Math.floor(Date.parse("2026-04-08T10:00:00.000Z") / 1000),
      }),
    },
  ], {
    subscribers: 5_000,
    accountsActive: 800,
  });

  await runRedditPhase1Cycle(
    {
      monitorTargetRepository,
      collectionJobRepository,
      rawEventRepository,
      accountRepository,
      contentRepository,
      crawlCursorRepository,
      metricsSnapshotRepository,
      postEngagementRepository,
      subredditDailyFactRepository,
      postGrowthFactRepository,
      subredditTrendPointRepository,
      anomalyEventRepository,
      redditConnector: connector,
      redditMapper: new DefaultRedditMapper(),
    },
    nowIso,
    {
      targetCanonicalNames: [`r/${subreddit}`],
      crawlMode: "backfill",
      postLimit: 3,
      backfillTargetDays: 15,
      backfillMaxIterationsPerTarget: 5,
    },
  );

  assert.deepEqual(connector.seenAfter, [undefined, "t3_cursor_1", "t3_cursor_2"]);
  assert.equal(contentRepository.all().length, 9);
  assert.equal(
    contentRepository.all().some((row) => row.createdAtSource <= "2026-04-09T12:00:00.000Z"),
    true,
  );
  const sampledFactsByDay = new Map(
    subredditDailyFactRepository.all().map((fact) => [fact.day, fact.sampledPostVolume] as const),
  );
  assert.equal(sampledFactsByDay.get("2026-04-24"), 3);
  assert.equal(sampledFactsByDay.get("2026-04-18"), 3);
  assert.equal(sampledFactsByDay.get("2026-04-08"), 3);
});

test("phase1 cycle backfill default budget reaches 15-day coverage for higher-volume targets", async () => {
  const nowIso = "2026-04-24T12:00:00.000Z";
  const subreddit = "technology";
  const targetId = stableUuidFromString(`reddit:target:r/${subreddit}`);

  const monitorTargetRepository = new InMemoryMonitorTargetRepository();
  const collectionJobRepository = new InMemoryCollectionJobRepository();
  const rawEventRepository = new InMemoryRawEventRepository();
  const accountRepository = new InMemoryAccountRepository();
  const contentRepository = new InMemoryContentRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
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

  const pageSpacingHours = 30;
  const connector = new ScriptedBackfillConnector(
    Array.from({ length: 13 }, (_, index) => {
      const pageNumber = index + 1;
      const nextCursor = pageNumber < 13 ? `t3_cursor_${pageNumber}` : undefined;
      const newestPostIso = new Date(
        Date.parse(nowIso) - index * pageSpacingHours * 60 * 60 * 1000,
      ).toISOString();
      return {
        nextCursor,
        posts: buildBackfillPosts({
          subreddit,
          prefix: `page${pageNumber}`,
          count: 100,
          baseCreatedUtc: Math.floor(Date.parse(newestPostIso) / 1000),
          scoreForIndex: (postIndex) => (postIndex % 20 === 0 ? 80 : 12),
          commentsForIndex: (postIndex) => (postIndex % 20 === 0 ? 30 : 4),
        }),
      };
    }),
    {
      subscribers: 2_000_000,
      accountsActive: 120_000,
    },
  );

  await runRedditPhase1Cycle(
    {
      monitorTargetRepository,
      collectionJobRepository,
      rawEventRepository,
      accountRepository,
      contentRepository,
      crawlCursorRepository,
      metricsSnapshotRepository,
      postEngagementRepository,
      subredditDailyFactRepository,
      postGrowthFactRepository,
      subredditTrendPointRepository,
      anomalyEventRepository,
      redditConnector: connector,
      redditMapper: new DefaultRedditMapper(),
    },
    nowIso,
    {
      targetCanonicalNames: [`r/${subreddit}`],
      crawlMode: "backfill",
      backfillTargetDays: 15,
    },
  );

  assert.equal(connector.seenAfter.length, 13);
  assert.equal(
    contentRepository.all().some((row) => row.createdAtSource <= "2026-04-09T12:00:00.000Z"),
    true,
  );
  assert.equal(
    subredditDailyFactRepository.all().some((fact) => fact.day <= "2026-04-09"),
    true,
  );
});

test("phase1 cycle backfill supplements high-volume subreddit with top listings when new-only depth stalls", async () => {
  const nowIso = "2026-04-24T12:00:00.000Z";
  const subreddit = "overwatch";
  const targetId = stableUuidFromString(`reddit:target:r/${subreddit}`);

  const monitorTargetRepository = new InMemoryMonitorTargetRepository();
  const collectionJobRepository = new InMemoryCollectionJobRepository();
  const rawEventRepository = new InMemoryRawEventRepository();
  const accountRepository = new InMemoryAccountRepository();
  const contentRepository = new InMemoryContentRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
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

  class OverwatchBackfillConnector implements RedditConnector {
    public readonly sourceCode = "reddit" as const;
    public readonly seenRequests: RedditCollectSubredditPostsArgs[] = [];

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
          responseHeaders: {},
          payload: {
            data: {
              display_name: args.subreddit,
              subscribers: 5_000_000,
              accounts_active: 150_000,
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
      this.seenRequests.push({ ...args });
      const listing = args.listing === "top" ? "top" : "new";
      const posts =
        listing === "new"
          ? buildBackfillPosts({
              subreddit,
              prefix: "recent",
              count: 100,
              baseCreatedUtc: Math.floor(Date.parse("2026-04-21T12:00:00.000Z") / 1000),
              scoreForIndex: (index) => (index % 20 === 0 ? 80 : 12),
              commentsForIndex: (index) => (index % 20 === 0 ? 30 : 4),
            })
          : buildBackfillPosts({
              subreddit,
              prefix: `top_${args.timeRange ?? "week"}`,
              count: 20,
              baseCreatedUtc: Math.floor(
                Date.parse(
                  args.timeRange === "all"
                    ? "2026-04-06T12:00:00.000Z"
                    : args.timeRange === "year"
                      ? "2026-04-07T12:00:00.000Z"
                      : args.timeRange === "month"
                        ? "2026-04-08T12:00:00.000Z"
                        : "2026-04-14T12:00:00.000Z",
                ) / 1000,
              ),
              scoreForIndex: () => 120,
              commentsForIndex: () => 45,
            });

      return {
        raw: {
          endpoint: `/r/${args.subreddit}/${listing}.json`,
          requestParams: {
            limit: args.limit,
            after: args.after,
            t: listing === "top" ? args.timeRange ?? "week" : undefined,
          },
          httpStatus: 200,
          responseHeaders: {},
          payload: {
            data: {
              after: listing === "new" ? "t3_overwatch_cursor_1" : undefined,
              children: posts.map((post) => ({ kind: "t3", data: post })),
            },
          },
          fetchedAt: ctx.now,
        },
        nextCursor: listing === "new" ? "t3_overwatch_cursor_1" : undefined,
      };
    }

    public async healthCheck(_ctx: ConnectorRequestContext): Promise<boolean> {
      return true;
    }
  }

  const connector = new OverwatchBackfillConnector();

  await runRedditPhase1Cycle(
    {
      monitorTargetRepository,
      collectionJobRepository,
      rawEventRepository,
      accountRepository,
      contentRepository,
      crawlCursorRepository,
      metricsSnapshotRepository,
      postEngagementRepository,
      subredditDailyFactRepository,
      postGrowthFactRepository,
      subredditTrendPointRepository,
      anomalyEventRepository,
      redditConnector: connector,
      redditMapper: new DefaultRedditMapper(),
    },
    nowIso,
    {
      targetCanonicalNames: [`r/${subreddit}`],
      crawlMode: "backfill",
      backfillTargetDays: 15,
      backfillMaxIterationsPerTarget: 3,
    },
  );

  const oldEnoughPosts = await contentRepository.findByTargetCreatedAtRange({
    targetId,
    from: "1970-01-01T00:00:00.000Z",
    to: "2026-04-09T12:00:00.000Z",
    limit: 5,
  });

  assert.equal(oldEnoughPosts.length > 0, true);
  assert.deepEqual(
    connector.seenRequests.map(
      (request) => `${request.listing ?? "new"}:${request.timeRange ?? "-"}:${request.after ?? "-"}`,
    ),
    [
      "new:-:-",
      "top:week:-",
      "top:month:-",
      "top:year:-",
      "top:all:-",
      "new:-:t3_overwatch_cursor_1",
    ],
  );
  assert.equal(crawlCursorRepository.all().some((cursor) => cursor.cursor === "t3_overwatch_cursor_1"), true);
  const latestBackfillCursor = crawlCursorRepository
    .all()
    .find((cursor) => cursor.targetId === targetId && cursor.mode === "backfill");
  assert.equal(latestBackfillCursor?.oldestObservedAt, "2026-04-21T12:00:00.000Z");
  assert.equal(latestBackfillCursor?.backfillCoverageStatus, "saturated_before_15d");
  assert.equal(latestBackfillCursor?.backfillStopReason, "cursor_saturated");
  assert.equal(
    contentRepository.all().some((row) => row.createdAtSource <= "2026-04-07T12:00:00.000Z"),
    true,
  );
});

test("phase1 cycle backfill stops when cursor repeats without pushing chronological history older", async () => {
  const nowIso = "2026-04-24T12:00:00.000Z";
  const subreddit = "cursorstalled";
  const targetId = stableUuidFromString(`reddit:target:r/${subreddit}`);

  const monitorTargetRepository = new InMemoryMonitorTargetRepository();
  const collectionJobRepository = new InMemoryCollectionJobRepository();
  const rawEventRepository = new InMemoryRawEventRepository();
  const accountRepository = new InMemoryAccountRepository();
  const contentRepository = new InMemoryContentRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
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

  class SaturatedBackfillConnector implements RedditConnector {
    public readonly sourceCode = "reddit" as const;
    public readonly seenAfter: Array<string | undefined> = [];

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
          responseHeaders: {},
          payload: {
            data: {
              display_name: args.subreddit,
              subscribers: 1_000_000,
              accounts_active: 20_000,
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
      this.seenAfter.push(args.after);
      const posts = buildBackfillPosts({
        subreddit,
        prefix: args.after ? "repeat" : "head",
        count: 3,
        baseCreatedUtc: Math.floor(Date.parse("2026-04-22T12:00:00.000Z") / 1000),
        scoreForIndex: () => 90,
        commentsForIndex: () => 30,
      });
      return {
        raw: {
          endpoint: `/r/${args.subreddit}/new.json`,
          requestParams: {
            limit: args.limit,
            after: args.after,
          },
          httpStatus: 200,
          responseHeaders: {},
          payload: {
            data: {
              after: "t3_repeat_cursor",
              children: posts.map((post) => ({ kind: "t3", data: post })),
            },
          },
          fetchedAt: ctx.now,
        },
        nextCursor: "t3_repeat_cursor",
      };
    }

    public async healthCheck(_ctx: ConnectorRequestContext): Promise<boolean> {
      return true;
    }
  }

  const connector = new SaturatedBackfillConnector();

  await runRedditPhase1Cycle(
    {
      monitorTargetRepository,
      collectionJobRepository,
      rawEventRepository,
      accountRepository,
      contentRepository,
      crawlCursorRepository,
      metricsSnapshotRepository,
      postEngagementRepository,
      subredditDailyFactRepository,
      postGrowthFactRepository,
      subredditTrendPointRepository,
      anomalyEventRepository,
      redditConnector: connector,
      redditMapper: new DefaultRedditMapper(),
    },
    nowIso,
    {
      targetCanonicalNames: [`r/${subreddit}`],
      crawlMode: "backfill",
      postLimit: 3,
      backfillTargetDays: 15,
      backfillMaxIterationsPerTarget: 5,
    },
  );

  assert.deepEqual(connector.seenAfter, [undefined, "t3_repeat_cursor"]);
  const latestBackfillCursor = crawlCursorRepository
    .all()
    .find((cursor) => cursor.targetId === targetId && cursor.mode === "backfill");
  assert.equal(latestBackfillCursor?.oldestObservedAt, "2026-04-22T12:00:00.000Z");
  assert.equal(latestBackfillCursor?.backfillCoverageStatus, "saturated_before_15d");
  assert.equal(latestBackfillCursor?.backfillStopReason, "cursor_saturated");
  assert.equal(collectionJobRepository.all().length, 3);
});

test("phase1 cycle backfill progress stays scoped to the active provider state", async () => {
  const nowIso = "2026-04-24T12:00:00.000Z";
  const subreddit = "providerstatescope";
  const targetId = stableUuidFromString(`reddit:target:r/${subreddit}`);

  const monitorTargetRepository = new InMemoryMonitorTargetRepository();
  const collectionJobRepository = new InMemoryCollectionJobRepository();
  const rawEventRepository = new InMemoryRawEventRepository();
  const accountRepository = new InMemoryAccountRepository();
  const contentRepository = new InMemoryContentRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const postEngagementRepository = new InMemoryPostEngagementRepository();
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

  await crawlCursorRepository.upsert({
    provider: "legacy_apify",
    targetId,
    mode: "backfill",
    cursor: "t3_legacy_stalled",
    oldestObservedAt: "2026-04-22T12:00:00.000Z",
    newestObservedAt: "2026-04-24T11:00:00.000Z",
    backfillTargetFromIso: "2026-04-09T12:00:00.000Z",
    backfillCoverageStatus: "saturated_before_15d",
    backfillStopReason: "cursor_saturated",
    lastFetchedAt: nowIso,
    updatedAt: nowIso,
  });

  const connector = new ScriptedBackfillConnector([
    {
      nextCursor: "t3_http_cursor_1",
      posts: buildBackfillPosts({
        subreddit,
        prefix: "http",
        count: 3,
        baseCreatedUtc: Math.floor(Date.parse("2026-04-20T12:00:00.000Z") / 1000),
        scoreForIndex: () => 90,
        commentsForIndex: () => 30,
      }),
    },
  ]);

  await runRedditPhase1Cycle(
    {
      monitorTargetRepository,
      collectionJobRepository,
      rawEventRepository,
      accountRepository,
      contentRepository,
      crawlCursorRepository,
      metricsSnapshotRepository,
      postEngagementRepository,
      subredditDailyFactRepository,
      postGrowthFactRepository,
      subredditTrendPointRepository,
      anomalyEventRepository,
      redditConnector: connector,
      redditMapper: new DefaultRedditMapper(),
    },
    nowIso,
    {
      targetCanonicalNames: [`r/${subreddit}`],
      crawlMode: "backfill",
      providerHint: "http",
      postLimit: 3,
      backfillTargetDays: 15,
      backfillMaxIterationsPerTarget: 1,
    },
  );

  assert.deepEqual(connector.seenAfter, [undefined]);

  const httpCursor = await crawlCursorRepository.resolve({
    provider: "http",
    targetId,
    mode: "backfill",
  });
  assert.equal(httpCursor?.cursor, "t3_http_cursor_1");
  assert.equal(httpCursor?.backfillCoverageStatus, "progressing");
  assert.equal(httpCursor?.backfillStopReason, "iteration_budget_exhausted");

  const legacyCursor = await crawlCursorRepository.resolve({
    provider: "legacy_apify",
    targetId,
    mode: "backfill",
  });
  assert.equal(legacyCursor?.cursor, "t3_legacy_stalled");
  assert.equal(legacyCursor?.backfillCoverageStatus, "saturated_before_15d");
  assert.equal(legacyCursor?.backfillStopReason, "cursor_saturated");
});
