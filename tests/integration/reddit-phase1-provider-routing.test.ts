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
  InMemoryMetricsSnapshotRepository,
  InMemoryMonitorTargetRepository,
  InMemoryProviderHealthWindowRepository,
  InMemoryRawEventRepository,
  InMemorySubredditTrendPointRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";
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

