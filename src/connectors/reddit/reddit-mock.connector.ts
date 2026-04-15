import type {
  ConnectorPage,
  ConnectorRequestContext,
} from "../shared/connector.interface";
import type { RedditConnector } from "./reddit-connector.interface";
import type {
  RedditAboutPayload,
  RedditCollectSubredditAboutArgs,
  RedditCollectSubredditPostsArgs,
  RedditListingPayload,
  RedditPostData,
} from "./reddit.types";

export class RedditMockConnector implements RedditConnector {
  public readonly sourceCode = "reddit" as const;

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
            name: `t5_${args.subreddit}`,
            subscribers: 123456,
            accounts_active: 4321,
          },
        },
        fetchedAt: ctx.now,
      },
      rateLimit: {
        limit: 1000,
        remaining: 999,
      },
    };
  }

  public async collectSubredditPosts(
    args: RedditCollectSubredditPostsArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditListingPayload<RedditPostData>>> {
    const nowSec = Math.floor(new Date(ctx.now).getTime() / 1000);
    const payload: RedditListingPayload<RedditPostData> = {
      data: {
        after: undefined,
        children: [
          {
            kind: "t3",
            data: {
              name: "t3_mock_1",
              id: "mock_1",
              subreddit: args.subreddit,
              author: "mock_user_1",
              title: "Mock post 1",
              selftext: "mock body 1",
              url: "https://example.com/mock-1",
              permalink: `/r/${args.subreddit}/comments/mock_1`,
              created_utc: nowSec - 180,
              score: 120,
              num_comments: 14,
              upvote_ratio: 0.94,
            },
          },
          {
            kind: "t3",
            data: {
              name: "t3_mock_2",
              id: "mock_2",
              subreddit: args.subreddit,
              author: "mock_user_2",
              title: "Mock post 2",
              selftext: "mock body 2",
              url: "https://example.com/mock-2",
              permalink: `/r/${args.subreddit}/comments/mock_2`,
              created_utc: nowSec - 60,
              score: 50,
              num_comments: 7,
              upvote_ratio: 0.88,
            },
          },
        ],
      },
    };

    return {
      raw: {
        endpoint: `/r/${args.subreddit}/new.json`,
        requestParams: {
          limit: args.limit,
          after: args.after,
        },
        httpStatus: 200,
        responseHeaders: {},
        payload,
        fetchedAt: ctx.now,
      },
      nextCursor: undefined,
      rateLimit: {
        limit: 1000,
        remaining: 998,
      },
    };
  }

  public async healthCheck(_ctx: ConnectorRequestContext): Promise<boolean> {
    return true;
  }
}

