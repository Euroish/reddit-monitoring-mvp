import assert from "node:assert/strict";
import test from "node:test";
import type { RedditConnector } from "../../src/connectors/reddit/reddit-connector.interface";
import type { ConnectorPage, ConnectorRequestContext } from "../../src/connectors/shared/connector.interface";
import { DefaultRedditMapper } from "../../src/connectors/reddit/reddit.mapper";
import type {
  RedditAboutPayload,
  RedditCollectSubredditAboutArgs,
  RedditCollectSubredditPostsArgs,
  RedditListingPayload,
  RedditPostData,
} from "../../src/connectors/reddit/reddit.types";
import { collectSubredditNewPostsJob } from "../../src/jobs/collect-subreddit-new-posts.job";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryAccountRepository,
  InMemoryCollectionJobRepository,
  InMemoryContentRepository,
  InMemoryCrawlCursorRepository,
  InMemoryMetricsSnapshotRepository,
  InMemoryProviderHealthWindowRepository,
  InMemoryRawEventRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";

class ScriptedPostsConnector implements RedditConnector {
  public readonly sourceCode = "reddit" as const;
  public readonly seenAfter: Array<string | undefined> = [];
  private callIndex = 0;

  constructor(
    private readonly script: Array<{
      nextCursor?: string;
      posts: RedditPostData[];
      provider?: string;
      fallback?: boolean;
    }>,
  ) {}

  public async collect(
    args: RedditCollectSubredditPostsArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditListingPayload<RedditPostData>>> {
    return this.collectSubredditPosts(args, ctx);
  }

  public async collectSubredditAbout(
    _args: RedditCollectSubredditAboutArgs,
    _ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditAboutPayload>> {
    throw new Error("not implemented");
  }

  public async collectSubredditPosts(
    args: RedditCollectSubredditPostsArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditListingPayload<RedditPostData>>> {
    this.seenAfter.push(args.after);
    const current = this.script[Math.min(this.callIndex, this.script.length - 1)];
    this.callIndex += 1;
    return {
      raw: {
        endpoint: `/r/${args.subreddit}/new.json`,
        requestParams: {
          limit: args.limit,
          after: args.after,
        },
        httpStatus: 200,
        responseHeaders: {
          ...(current.provider ? { "x-provider": current.provider } : {}),
          ...(current.fallback ? { "x-provider-fallback": "circuit_breaker" } : {}),
        },
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

function buildPostsBatch(args: {
  subreddit: string;
  prefix: string;
  count: number;
  baseCreatedUtc: number;
}): RedditPostData[] {
  return Array.from({ length: args.count }, (_, index) => ({
    name: `t3_${args.prefix}_${index}`,
    id: `${args.prefix}_${index}`,
    subreddit: args.subreddit,
    author: `user_${index}`,
    title: `${args.prefix} title ${index}`,
    permalink: `/r/${args.subreddit}/comments/${args.prefix}_${index}/post`,
    created_utc: args.baseCreatedUtc + index,
    score: 10 + (index % 7),
    num_comments: 2 + (index % 5),
    upvote_ratio: 0.7,
  }));
}

test("collect subreddit new posts applies candidate filter and records provider health", async () => {
  const nowIso = "2026-04-10T12:00:00.000Z";
  const targetId = stableUuidFromString("reddit:target:r/datascience");
  const connector = new ScriptedPostsConnector([
    {
      nextCursor: "t3_after_1",
      provider: "http",
      posts: [
        {
          name: "t3_high",
          id: "high",
          subreddit: "datascience",
          author: "alice",
          title: "high score post",
          permalink: "/r/datascience/comments/high/post",
          created_utc: 1_712_750_000,
          score: 180,
          num_comments: 24,
          upvote_ratio: 0.95,
        },
        {
          name: "t3_low",
          id: "low",
          subreddit: "datascience",
          author: "bob",
          title: "low score post",
          permalink: "/r/datascience/comments/low/post",
          created_utc: 1_712_750_060,
          score: 9,
          num_comments: 1,
          upvote_ratio: 0.72,
        },
      ],
    },
  ]);
  const mapper = new DefaultRedditMapper();
  const collectionJobRepository = new InMemoryCollectionJobRepository();
  const rawEventRepository = new InMemoryRawEventRepository();
  const accountRepository = new InMemoryAccountRepository();
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();

  await collectSubredditNewPostsJob(
    {
      redditConnector: connector,
      redditMapper: mapper,
      collectionJobRepository,
      crawlCursorRepository,
      rawEventRepository,
      accountRepository,
      contentRepository,
      metricsSnapshotRepository,
      providerHealthWindowRepository,
    },
    {
      targetId,
      subreddit: "datascience",
      nowIso,
      mode: "live",
      providerHint: "http",
      candidateFilter: {
        minScore: 100,
        minComments: 10,
        mode: "and",
      },
    },
  );

  assert.equal(rawEventRepository.all().length, 1);
  assert.equal(contentRepository.all().length, 2);
  const snapshots = metricsSnapshotRepository.all();
  const newPostsMetric = snapshots.find((item) => item.metricName === "new_posts_15m");
  assert.equal(newPostsMetric?.metricValue, 2);
  assert.equal(snapshots.filter((item) => item.metricName === "score").length, 2);
  assert.equal(snapshots.filter((item) => item.metricName === "num_comments").length, 2);

  const providerRows = providerHealthWindowRepository.all();
  assert.equal(providerRows.length, 1);
  assert.equal(providerRows[0]?.provider, "http");
  assert.equal(providerRows[0]?.requestCount, 1);
  assert.equal(providerRows[0]?.successCount, 1);
  assert.equal(providerRows[0]?.candidateCount, 2);
  assert.equal(providerRows[0]?.acceptedCount, 1);
  assert.equal(providerRows[0]?.filteredOutCount, 1);
  assert.equal(providerRows[0]?.duplicatePostCount, 0);
  assert.equal(providerRows[0]?.ingestLagSampleCount, 2);
  assert.equal(providerRows[0]?.providerDiffSampleCount, 0);
});

test("collect subreddit new posts live mode re-polls head page every 5 minutes", async () => {
  const targetId = stableUuidFromString("reddit:target:r/machinelearning");
  const connector = new ScriptedPostsConnector([
    {
      nextCursor: "t3_live_cursor_1",
      provider: "http",
      posts: [
        {
          name: "t3_first",
          id: "first",
          subreddit: "machinelearning",
          author: "alice",
          title: "first",
          permalink: "/r/machinelearning/comments/first/post",
          created_utc: 1_712_751_000,
          score: 40,
          num_comments: 4,
        },
      ],
    },
    {
      nextCursor: "t3_live_cursor_2",
      provider: "http",
      posts: [
        {
          name: "t3_first",
          id: "first",
          subreddit: "machinelearning",
          author: "alice",
          title: "first",
          permalink: "/r/machinelearning/comments/first/post",
          created_utc: 1_712_751_000,
          score: 45,
          num_comments: 5,
        },
        {
          name: "t3_second",
          id: "second",
          subreddit: "machinelearning",
          author: "bob",
          title: "second",
          permalink: "/r/machinelearning/comments/second/post",
          created_utc: 1_712_751_120,
          score: 50,
          num_comments: 6,
        },
      ],
    },
  ]);
  const mapper = new DefaultRedditMapper();
  const collectionJobRepository = new InMemoryCollectionJobRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();

  const deps = {
    redditConnector: connector,
    redditMapper: mapper,
    collectionJobRepository,
    crawlCursorRepository,
    rawEventRepository: new InMemoryRawEventRepository(),
    accountRepository: new InMemoryAccountRepository(),
    contentRepository: new InMemoryContentRepository(),
    metricsSnapshotRepository,
    providerHealthWindowRepository: new InMemoryProviderHealthWindowRepository(),
  };

  await collectSubredditNewPostsJob(deps, {
    targetId,
    subreddit: "machinelearning",
    nowIso: "2026-04-10T12:00:00.000Z",
    mode: "live",
    providerHint: "http",
  });
  await collectSubredditNewPostsJob(deps, {
    targetId,
    subreddit: "machinelearning",
    nowIso: "2026-04-10T12:05:00.000Z",
    mode: "live",
    providerHint: "http",
  });

  assert.deepEqual(connector.seenAfter, [undefined, undefined]);
  const crawlCursor = await crawlCursorRepository.resolve({
    provider: "http",
    targetId,
    mode: "live",
  });
  assert.equal(crawlCursor?.cursor, "t3_live_cursor_2");
  assert.equal(crawlCursor?.rewindCursor, undefined);
  assert.equal(crawlCursor?.lastFetchedAt, "2026-04-10T12:05:00.000Z");

  const newPostSnapshots = metricsSnapshotRepository
    .all()
    .filter((item) => item.metricName === "new_posts_15m")
    .sort((a, b) => a.snapshotAt.localeCompare(b.snapshotAt));
  assert.deepEqual(
    newPostSnapshots.map((item) => ({ snapshotAt: item.snapshotAt, metricValue: item.metricValue })),
    [
      { snapshotAt: "2026-04-10T12:00:00.000Z", metricValue: 1 },
      { snapshotAt: "2026-04-10T12:05:00.000Z", metricValue: 1 },
    ],
  );
});

test("collect subreddit new posts live mode catches burst overflow pages in the same run", async () => {
  const targetId = stableUuidFromString("reddit:target:r/bursting");
  const connector = new ScriptedPostsConnector([
    {
      nextCursor: "t3_live_cursor_1",
      provider: "http",
      posts: [
        {
          name: "t3_first",
          id: "first",
          subreddit: "bursting",
          author: "alice",
          title: "first",
          permalink: "/r/bursting/comments/first/post",
          created_utc: 1_712_751_000,
          score: 40,
          num_comments: 4,
        },
        {
          name: "t3_second",
          id: "second",
          subreddit: "bursting",
          author: "bob",
          title: "second",
          permalink: "/r/bursting/comments/second/post",
          created_utc: 1_712_751_060,
          score: 44,
          num_comments: 5,
        },
      ],
    },
    {
      nextCursor: "t3_live_cursor_2",
      provider: "http",
      posts: [
        {
          name: "t3_third",
          id: "third",
          subreddit: "bursting",
          author: "charlie",
          title: "third",
          permalink: "/r/bursting/comments/third/post",
          created_utc: 1_712_751_120,
          score: 50,
          num_comments: 6,
        },
        {
          name: "t3_fourth",
          id: "fourth",
          subreddit: "bursting",
          author: "dave",
          title: "fourth",
          permalink: "/r/bursting/comments/fourth/post",
          created_utc: 1_712_751_180,
          score: 52,
          num_comments: 7,
        },
      ],
    },
    {
      provider: "http",
      posts: [
        {
          name: "t3_fifth",
          id: "fifth",
          subreddit: "bursting",
          author: "eve",
          title: "fifth",
          permalink: "/r/bursting/comments/fifth/post",
          created_utc: 1_712_751_240,
          score: 55,
          num_comments: 8,
        },
      ],
    },
  ]);

  const rawEventRepository = new InMemoryRawEventRepository();
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();

  await collectSubredditNewPostsJob(
    {
      redditConnector: connector,
      redditMapper: new DefaultRedditMapper(),
      collectionJobRepository: new InMemoryCollectionJobRepository(),
      crawlCursorRepository: new InMemoryCrawlCursorRepository(),
      rawEventRepository,
      accountRepository: new InMemoryAccountRepository(),
      contentRepository,
      metricsSnapshotRepository,
      providerHealthWindowRepository,
    },
    {
      targetId,
      subreddit: "bursting",
      nowIso: "2024-04-10T12:20:00.000Z",
      mode: "live",
      providerHint: "http",
      limit: 2,
    },
  );

  assert.deepEqual(connector.seenAfter, [undefined, "t3_live_cursor_1", "t3_live_cursor_2"]);
  assert.equal(rawEventRepository.all().length, 3);
  assert.equal(contentRepository.all().length, 5);
  const newPostsMetric = metricsSnapshotRepository
    .all()
    .find((item) => item.metricName === "new_posts_15m");
  assert.equal(newPostsMetric?.metricValue, 5);
  const providerRow = providerHealthWindowRepository.all()[0];
  assert.equal(providerRow?.requestCount, 3);
  assert.equal(providerRow?.candidateCount, 5);
});

test("collect subreddit new posts boost tier expands live overflow depth", async () => {
  const targetId = stableUuidFromString("reddit:target:r/stale-head-boost");
  const connector = new ScriptedPostsConnector([
    {
      nextCursor: "t3_cursor_1",
      provider: "http",
      posts: buildPostsBatch({
        subreddit: "stale-head-boost",
        prefix: "page1",
        count: 40,
        baseCreatedUtc: 1_712_752_000,
      }),
    },
    {
      nextCursor: "t3_cursor_2",
      provider: "http",
      posts: buildPostsBatch({
        subreddit: "stale-head-boost",
        prefix: "page2",
        count: 40,
        baseCreatedUtc: 1_712_752_100,
      }),
    },
    {
      nextCursor: "t3_cursor_3",
      provider: "http",
      posts: buildPostsBatch({
        subreddit: "stale-head-boost",
        prefix: "page3",
        count: 40,
        baseCreatedUtc: 1_712_752_200,
      }),
    },
    {
      provider: "http",
      posts: buildPostsBatch({
        subreddit: "stale-head-boost",
        prefix: "page4",
        count: 40,
        baseCreatedUtc: 1_712_752_300,
      }),
    },
  ]);
  const rawEventRepository = new InMemoryRawEventRepository();
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();

  await collectSubredditNewPostsJob(
    {
      redditConnector: connector,
      redditMapper: new DefaultRedditMapper(),
      collectionJobRepository: new InMemoryCollectionJobRepository(),
      crawlCursorRepository: new InMemoryCrawlCursorRepository(),
      rawEventRepository,
      accountRepository: new InMemoryAccountRepository(),
      contentRepository: new InMemoryContentRepository(),
      metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
      providerHealthWindowRepository,
    },
    {
      targetId,
      subreddit: "stale-head-boost",
      nowIso: "2024-04-10T12:40:00.000Z",
      mode: "live",
      providerHint: "http",
      limit: 40,
      samplingTier: "boost",
    },
  );

  assert.deepEqual(connector.seenAfter, [undefined, "t3_cursor_1", "t3_cursor_2", "t3_cursor_3"]);
  assert.equal(rawEventRepository.all().length, 4);
  assert.equal(providerHealthWindowRepository.all()[0]?.requestCount, 4);
});

test("collect subreddit new posts live mode stops overflow when head page is already stale", async () => {
  const targetId = stableUuidFromString("reddit:target:r/stale-head-stop");
  const connector = new ScriptedPostsConnector([
    {
      nextCursor: "t3_cursor_1",
      provider: "http",
      posts: [
        {
          name: "t3_old_1",
          id: "old_1",
          subreddit: "stale-head-stop",
          author: "alice",
          title: "old post 1",
          permalink: "/r/stale-head-stop/comments/old_1/post",
          created_utc: 1_712_450_000,
          score: 10,
          num_comments: 1,
        },
        {
          name: "t3_old_2",
          id: "old_2",
          subreddit: "stale-head-stop",
          author: "bob",
          title: "old post 2",
          permalink: "/r/stale-head-stop/comments/old_2/post",
          created_utc: 1_712_450_060,
          score: 11,
          num_comments: 2,
        },
      ],
    },
    {
      provider: "http",
      posts: [
        {
          name: "t3_old_3",
          id: "old_3",
          subreddit: "stale-head-stop",
          author: "carol",
          title: "old post 3",
          permalink: "/r/stale-head-stop/comments/old_3/post",
          created_utc: 1_712_450_120,
          score: 12,
          num_comments: 3,
        },
      ],
    },
  ]);

  const rawEventRepository = new InMemoryRawEventRepository();
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();

  await collectSubredditNewPostsJob(
    {
      redditConnector: connector,
      redditMapper: new DefaultRedditMapper(),
      collectionJobRepository: new InMemoryCollectionJobRepository(),
      crawlCursorRepository: new InMemoryCrawlCursorRepository(),
      rawEventRepository,
      accountRepository: new InMemoryAccountRepository(),
      contentRepository: new InMemoryContentRepository(),
      metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
      providerHealthWindowRepository,
    },
    {
      targetId,
      subreddit: "stale-head-stop",
      nowIso: "2024-04-10T12:20:00.000Z",
      mode: "live",
      providerHint: "http",
      limit: 2,
    },
  );

  assert.deepEqual(connector.seenAfter, [undefined]);
  assert.equal(rawEventRepository.all().length, 1);
  assert.equal(providerHealthWindowRepository.all()[0]?.requestCount, 1);
});

test("collect subreddit new posts live mode stops deep overflow when tail page is too old", async () => {
  const targetId = stableUuidFromString("reddit:target:r/stale-tail-stop");
  const connector = new ScriptedPostsConnector([
    {
      nextCursor: "t3_cursor_1",
      provider: "http",
      posts: [
        {
          name: "t3_fresh_1",
          id: "fresh_1",
          subreddit: "stale-tail-stop",
          author: "alice",
          title: "fresh post 1",
          permalink: "/r/stale-tail-stop/comments/fresh_1/post",
          created_utc: 1_712_773_140,
          score: 30,
          num_comments: 6,
        },
        {
          name: "t3_fresh_2",
          id: "fresh_2",
          subreddit: "stale-tail-stop",
          author: "bob",
          title: "fresh post 2",
          permalink: "/r/stale-tail-stop/comments/fresh_2/post",
          created_utc: 1_712_773_080,
          score: 28,
          num_comments: 5,
        },
      ],
    },
    {
      nextCursor: "t3_cursor_2",
      provider: "http",
      posts: [
        {
          name: "t3_old_tail_1",
          id: "old_tail_1",
          subreddit: "stale-tail-stop",
          author: "carol",
          title: "old tail 1",
          permalink: "/r/stale-tail-stop/comments/old_tail_1/post",
          created_utc: 1_712_740_400,
          score: 12,
          num_comments: 2,
        },
        {
          name: "t3_old_tail_2",
          id: "old_tail_2",
          subreddit: "stale-tail-stop",
          author: "dave",
          title: "old tail 2",
          permalink: "/r/stale-tail-stop/comments/old_tail_2/post",
          created_utc: 1_712_740_340,
          score: 11,
          num_comments: 1,
        },
      ],
    },
    {
      provider: "http",
      posts: [
        {
          name: "t3_should_not_fetch",
          id: "should_not_fetch",
          subreddit: "stale-tail-stop",
          author: "eve",
          title: "should not fetch",
          permalink: "/r/stale-tail-stop/comments/should_not_fetch/post",
          created_utc: 1_712_773_200,
          score: 50,
          num_comments: 9,
        },
      ],
    },
  ]);

  const rawEventRepository = new InMemoryRawEventRepository();
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();

  await collectSubredditNewPostsJob(
    {
      redditConnector: connector,
      redditMapper: new DefaultRedditMapper(),
      collectionJobRepository: new InMemoryCollectionJobRepository(),
      crawlCursorRepository: new InMemoryCrawlCursorRepository(),
      rawEventRepository,
      accountRepository: new InMemoryAccountRepository(),
      contentRepository: new InMemoryContentRepository(),
      metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
      providerHealthWindowRepository,
    },
    {
      targetId,
      subreddit: "stale-tail-stop",
      nowIso: "2024-04-10T18:30:00.000Z",
      mode: "live",
      providerHint: "http",
      limit: 2,
    },
  );

  assert.deepEqual(connector.seenAfter, [undefined, "t3_cursor_1"]);
  assert.equal(rawEventRepository.all().length, 2);
  assert.equal(providerHealthWindowRepository.all()[0]?.requestCount, 2);
});

test("collect subreddit new posts backfill mode uses crawl cursor with one-step rewind", async () => {
  const targetId = stableUuidFromString("reddit:target:r/machinelearning");
  const connector = new ScriptedPostsConnector([
    {
      nextCursor: "t3_cursor_1",
      provider: "http",
      posts: [
        {
          name: "t3_first",
          id: "first",
          subreddit: "machinelearning",
          author: "alice",
          title: "first",
          permalink: "/r/machinelearning/comments/first/post",
          created_utc: 1_712_751_000,
          score: 40,
          num_comments: 4,
        },
      ],
    },
    {
      nextCursor: "t3_cursor_2",
      provider: "http",
      posts: [
        {
          name: "t3_second",
          id: "second",
          subreddit: "machinelearning",
          author: "bob",
          title: "second",
          permalink: "/r/machinelearning/comments/second/post",
          created_utc: 1_712_751_900,
          score: 50,
          num_comments: 6,
        },
      ],
    },
  ]);
  const mapper = new DefaultRedditMapper();
  const collectionJobRepository = new InMemoryCollectionJobRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();

  const deps = {
    redditConnector: connector,
    redditMapper: mapper,
    collectionJobRepository,
    crawlCursorRepository,
    rawEventRepository: new InMemoryRawEventRepository(),
    accountRepository: new InMemoryAccountRepository(),
    contentRepository: new InMemoryContentRepository(),
    metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
    providerHealthWindowRepository: new InMemoryProviderHealthWindowRepository(),
  };

  await collectSubredditNewPostsJob(deps, {
    targetId,
    subreddit: "machinelearning",
    nowIso: "2026-04-10T12:00:00.000Z",
    mode: "backfill",
    providerHint: "http",
  });
  await collectSubredditNewPostsJob(deps, {
    targetId,
    subreddit: "machinelearning",
    nowIso: "2026-04-10T12:16:00.000Z",
    mode: "backfill",
    providerHint: "http",
  });

  assert.deepEqual(connector.seenAfter, [undefined, "t3_cursor_1"]);
  const crawlCursor = await crawlCursorRepository.resolve({
    provider: "http",
    targetId,
    mode: "backfill",
  });
  assert.equal(crawlCursor?.cursor, "t3_cursor_2");
  assert.equal(crawlCursor?.rewindCursor, "t3_cursor_1");
});

test("collect subreddit new posts backfill mode paginates beyond single-page cap for high limits", async () => {
  const targetId = stableUuidFromString("reddit:target:r/backfill-high-limit");
  const connector = new ScriptedPostsConnector([
    {
      nextCursor: "t3_cursor_1",
      provider: "scrapling",
      posts: buildPostsBatch({
        subreddit: "backfill-high-limit",
        prefix: "page1",
        count: 100,
        baseCreatedUtc: 1_712_751_000,
      }),
    },
    {
      nextCursor: "t3_cursor_2",
      provider: "scrapling",
      posts: buildPostsBatch({
        subreddit: "backfill-high-limit",
        prefix: "page2",
        count: 50,
        baseCreatedUtc: 1_712_751_200,
      }),
    },
    {
      provider: "scrapling",
      posts: buildPostsBatch({
        subreddit: "backfill-high-limit",
        prefix: "page3",
        count: 10,
        baseCreatedUtc: 1_712_751_400,
      }),
    },
  ]);
  const contentRepository = new InMemoryContentRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();

  await collectSubredditNewPostsJob(
    {
      redditConnector: connector,
      redditMapper: new DefaultRedditMapper(),
      collectionJobRepository: new InMemoryCollectionJobRepository(),
      crawlCursorRepository,
      rawEventRepository: new InMemoryRawEventRepository(),
      accountRepository: new InMemoryAccountRepository(),
      contentRepository,
      metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
      providerHealthWindowRepository,
    },
    {
      targetId,
      subreddit: "backfill-high-limit",
      nowIso: "2026-04-10T12:40:00.000Z",
      mode: "backfill",
      providerHint: "scrapling",
      limit: 150,
    },
  );

  assert.deepEqual(connector.seenAfter, [undefined, "t3_cursor_1"]);
  assert.equal(contentRepository.all().length, 150);
  const providerRow = providerHealthWindowRepository.all()[0];
  assert.equal(providerRow?.provider, "scrapling");
  assert.equal(providerRow?.requestCount, 2);
  assert.equal(providerRow?.candidateCount, 150);

  const crawlCursor = await crawlCursorRepository.resolve({
    provider: "scrapling",
    targetId,
    mode: "backfill",
  });
  assert.equal(crawlCursor?.cursor, "t3_cursor_2");
  assert.equal(crawlCursor?.rewindCursor, undefined);
});

test("collect subreddit new posts backfill recovers fallback cursor and rewrites under provider hint", async () => {
  const targetId = stableUuidFromString("reddit:target:r/apify-backfill");
  const connector = new ScriptedPostsConnector([
    {
      nextCursor: "t3_cursor_3",
      provider: "http",
      fallback: true,
      posts: [
        {
          name: "t3_third",
          id: "third",
          subreddit: "apify-backfill",
          author: "charlie",
          title: "third",
          permalink: "/r/apify-backfill/comments/third/post",
          created_utc: 1_712_752_100,
          score: 44,
          num_comments: 7,
        },
      ],
    },
  ]);
  const mapper = new DefaultRedditMapper();
  const collectionJobRepository = new InMemoryCollectionJobRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();
  await crawlCursorRepository.upsert({
    provider: "http",
    targetId,
    mode: "backfill",
    cursor: "t3_cursor_2",
    rewindCursor: "t3_cursor_1",
    lastFetchedAt: "2026-04-10T12:05:00.000Z",
    updatedAt: "2026-04-10T12:05:00.000Z",
  });

  await collectSubredditNewPostsJob(
    {
      redditConnector: connector,
      redditMapper: mapper,
      collectionJobRepository,
      crawlCursorRepository,
      rawEventRepository: new InMemoryRawEventRepository(),
      accountRepository: new InMemoryAccountRepository(),
      contentRepository: new InMemoryContentRepository(),
      metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
      providerHealthWindowRepository: new InMemoryProviderHealthWindowRepository(),
    },
    {
      targetId,
      subreddit: "apify-backfill",
      nowIso: "2026-04-10T12:20:00.000Z",
      mode: "backfill",
      providerHint: "apify",
    },
  );

  assert.deepEqual(connector.seenAfter, ["t3_cursor_1"]);
  const crawlCursor = await crawlCursorRepository.resolve({
    provider: "apify",
    targetId,
    mode: "backfill",
  });
  assert.equal(crawlCursor?.cursor, "t3_cursor_3");
  assert.equal(crawlCursor?.rewindCursor, "t3_cursor_2");
});

test("collect subreddit new posts backfill marks terminal EOF and skips later no-op runs", async () => {
  const targetId = stableUuidFromString("reddit:target:r/backfill-eof");
  const connector = new ScriptedPostsConnector([
    {
      nextCursor: "t3_cursor_1",
      provider: "http",
      posts: [
        {
          name: "t3_first",
          id: "first",
          subreddit: "backfill-eof",
          author: "alice",
          title: "first",
          permalink: "/r/backfill-eof/comments/first/post",
          created_utc: 1_712_751_000,
          score: 40,
          num_comments: 4,
        },
      ],
    },
    {
      provider: "http",
      posts: [
        {
          name: "t3_second",
          id: "second",
          subreddit: "backfill-eof",
          author: "bob",
          title: "second",
          permalink: "/r/backfill-eof/comments/second/post",
          created_utc: 1_712_751_900,
          score: 50,
          num_comments: 6,
        },
      ],
    },
  ]);
  const collectionJobRepository = new InMemoryCollectionJobRepository();
  const crawlCursorRepository = new InMemoryCrawlCursorRepository();

  const deps = {
    redditConnector: connector,
    redditMapper: new DefaultRedditMapper(),
    collectionJobRepository,
    crawlCursorRepository,
    rawEventRepository: new InMemoryRawEventRepository(),
    accountRepository: new InMemoryAccountRepository(),
    contentRepository: new InMemoryContentRepository(),
    metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
    providerHealthWindowRepository: new InMemoryProviderHealthWindowRepository(),
  };

  await collectSubredditNewPostsJob(deps, {
    targetId,
    subreddit: "backfill-eof",
    nowIso: "2026-04-10T12:00:00.000Z",
    mode: "backfill",
    providerHint: "http",
  });
  await collectSubredditNewPostsJob(deps, {
    targetId,
    subreddit: "backfill-eof",
    nowIso: "2026-04-10T12:16:00.000Z",
    mode: "backfill",
    providerHint: "http",
  });
  await collectSubredditNewPostsJob(deps, {
    targetId,
    subreddit: "backfill-eof",
    nowIso: "2026-04-10T12:32:00.000Z",
    mode: "backfill",
    providerHint: "http",
  });

  assert.deepEqual(connector.seenAfter, [undefined, "t3_cursor_1"]);
  const crawlCursor = await crawlCursorRepository.resolve({
    provider: "http",
    targetId,
    mode: "backfill",
  });
  assert.equal(crawlCursor?.cursor, "__backfill_eof__");
  assert.equal(crawlCursor?.rewindCursor, undefined);
  assert.equal(collectionJobRepository.all().length, 2);
});

test("collect subreddit new posts records duplicates and provider diff observability", async () => {
  const nowIso = "2026-04-10T12:00:00.000Z";
  const targetId = stableUuidFromString("reddit:target:r/datascience");
  const connector = new ScriptedPostsConnector([
    {
      provider: "apify",
      posts: [
        {
          name: "t3_repeat",
          id: "repeat",
          subreddit: "datascience",
          author: "alice",
          title: "repeat post",
          permalink: "/r/datascience/comments/repeat/post",
          created_utc: 1_712_750_000,
          score: 50,
          num_comments: 12,
        },
      ],
    },
  ]);
  const mapper = new DefaultRedditMapper();
  const instrumentedConnector: RedditConnector = {
    sourceCode: "reddit",
    collect: (args, ctx) => connector.collect(args, ctx),
    collectSubredditAbout: (args, ctx) => connector.collectSubredditAbout(args, ctx),
    async collectSubredditPosts(args, ctx) {
      const result = await connector.collectSubredditPosts(args, ctx);
      result.raw.responseHeaders["x-compare-post-count-diff"] = "2";
      return result;
    },
    healthCheck: (ctx) => connector.healthCheck(ctx),
  };
  const contentRepository = new InMemoryContentRepository();
  const existingId = stableUuidFromString("reddit:content:t3_repeat");
  await contentRepository.upsertMany([
    {
      id: existingId,
      source: "reddit",
      targetId,
      accountId: stableUuidFromString("reddit:account:alice"),
      externalId: "t3_repeat",
      kind: "post",
      title: "repeat post",
      permalink: "/r/datascience/comments/repeat/post",
      createdAtSource: "2026-04-10T11:00:00.000Z",
      firstSeenAt: "2026-04-10T11:00:00.000Z",
      lastSeenAt: "2026-04-10T11:00:00.000Z",
    },
  ]);
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();

  await collectSubredditNewPostsJob(
    {
      redditConnector: instrumentedConnector,
      redditMapper: mapper,
      collectionJobRepository: new InMemoryCollectionJobRepository(),
      crawlCursorRepository: new InMemoryCrawlCursorRepository(),
      rawEventRepository: new InMemoryRawEventRepository(),
      accountRepository: new InMemoryAccountRepository(),
      contentRepository,
      metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
      providerHealthWindowRepository,
    },
    {
      targetId,
      subreddit: "datascience",
      nowIso,
      mode: "live",
      providerHint: "apify",
    },
  );

  const providerRows = providerHealthWindowRepository.all();
  assert.equal(providerRows[0]?.duplicatePostCount, 1);
  assert.equal(providerRows[0]?.providerDiffCount, 1);
  assert.equal(providerRows[0]?.providerDiffSampleCount, 1);
});

test("collect subreddit new posts records scrapling profile and session-key observability", async () => {
  const nowIso = "2026-04-10T12:00:00.000Z";
  const targetId = stableUuidFromString("reddit:target:r/scrapling-observed");
  const connector = new ScriptedPostsConnector([
    {
      nextCursor: "t3_after_1",
      provider: "scrapling",
      posts: buildPostsBatch({
        subreddit: "scrapling-observed",
        prefix: "scrapling",
        count: 2,
        baseCreatedUtc: 1_712_750_000,
      }),
    },
  ]);
  const mapper = new DefaultRedditMapper();
  const scraplingConnector: RedditConnector = {
    sourceCode: "reddit",
    collect: (args, ctx) => connector.collect(args, ctx),
    collectSubredditAbout: (args, ctx) => connector.collectSubredditAbout(args, ctx),
    async collectSubredditPosts(args, ctx) {
      const result = await connector.collectSubredditPosts(args, ctx);
      result.raw.responseHeaders["x-scrapling-profile"] = "dynamic";
      result.raw.responseHeaders["x-scrapling-fetcher"] = "dynamic";
      result.raw.responseHeaders["x-scrapling-session-key"] =
        "reddit:dynamic:/r/scrapling-observed/new.json";
      result.raw.responseHeaders["x-scrapling-session-key-reused"] = "1";
      return result;
    },
    healthCheck: (ctx) => connector.healthCheck(ctx),
  };
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();

  await collectSubredditNewPostsJob(
    {
      redditConnector: scraplingConnector,
      redditMapper: mapper,
      collectionJobRepository: new InMemoryCollectionJobRepository(),
      crawlCursorRepository: new InMemoryCrawlCursorRepository(),
      rawEventRepository: new InMemoryRawEventRepository(),
      accountRepository: new InMemoryAccountRepository(),
      contentRepository: new InMemoryContentRepository(),
      metricsSnapshotRepository: new InMemoryMetricsSnapshotRepository(),
      providerHealthWindowRepository,
    },
    {
      targetId,
      subreddit: "scrapling-observed",
      nowIso,
      mode: "live",
      providerHint: "scrapling",
    },
  );

  const providerRows = providerHealthWindowRepository.all();
  assert.equal(providerRows[0]?.provider, "scrapling");
  assert.equal(providerRows[0]?.scraplingDynamicProfileCount, 1);
  assert.equal(providerRows[0]?.scraplingHttpProfileCount, 0);
  assert.equal(providerRows[0]?.scraplingSessionKeyCount, 1);
  assert.equal(providerRows[0]?.scraplingSessionKeyReuseCount, 1);
  assert.equal(providerRows[0]?.lastScraplingProfile, "dynamic");
  assert.equal(providerRows[0]?.lastScraplingFetcher, "dynamic");
  assert.equal(
    providerRows[0]?.lastScraplingSessionKey,
    "reddit:dynamic:/r/scrapling-observed/new.json",
  );
});
