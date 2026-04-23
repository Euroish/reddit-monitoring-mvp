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
import {
  probeRedditProviderCapability,
  resolveRedditProviderCapabilityProbeConfigFromEnv,
} from "../../src/runtime/reddit-provider-capability";
import { createRedditCapabilityProbeConnectorFromEnv } from "../../src/runtime/reddit-phase1-runtime";

class ProviderCapabilityConnector implements RedditConnector {
  public readonly sourceCode = "reddit" as const;

  constructor(
    private readonly mode: "ok" | "http_error" | "throw",
  ) {}

  public async collectSubredditAbout(
    args: RedditCollectSubredditAboutArgs,
    ctx: ConnectorRequestContext,
  ): Promise<ConnectorPage<RedditAboutPayload>> {
    if (this.mode === "throw") {
      throw new Error(`provider failed for ${args.subreddit}`);
    }
    return {
      raw: {
        endpoint: `/r/${args.subreddit}/about.json`,
        requestParams: {},
        httpStatus: this.mode === "ok" ? 200 : 403,
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
    return true;
  }
}

test("resolveRedditProviderCapabilityProbeConfigFromEnv defaults to required askreddit probe", () => {
  const config = resolveRedditProviderCapabilityProbeConfigFromEnv({});

  assert.equal(config.required, true);
  assert.equal(config.provider, "http");
  assert.equal(config.subreddit, "askreddit");
});

test("resolveRedditProviderCapabilityProbeConfigFromEnv uses explicit probe subreddit and provider", () => {
  const config = resolveRedditProviderCapabilityProbeConfigFromEnv({
    REDDIT_PROVIDER_CAPABILITY_REQUIRED: "false",
    REDDIT_PROVIDER_CAPABILITY_SUBREDDIT: "r/NBA",
    REDDIT_LIVE_PROVIDER: "scrapling",
  });

  assert.equal(config.required, false);
  assert.equal(config.provider, "scrapling");
  assert.equal(config.subreddit, "nba");
});

test("probeRedditProviderCapability returns ok for 2xx about probe", async () => {
  const result = await probeRedditProviderCapability({
    connector: new ProviderCapabilityConnector("ok"),
    provider: "http",
    subreddit: "AskReddit",
    nowIso: "2026-04-22T12:00:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.subreddit, "askreddit");
  assert.equal(result.httpStatus, 200);
});

test("probeRedditProviderCapability reports unexpected http status failures", async () => {
  const result = await probeRedditProviderCapability({
    connector: new ProviderCapabilityConnector("http_error"),
    provider: "http",
    subreddit: "AskReddit",
    nowIso: "2026-04-22T12:00:00.000Z",
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "unexpected_http_status:403");
});

test("probeRedditProviderCapability reports connector exceptions", async () => {
  const result = await probeRedditProviderCapability({
    connector: new ProviderCapabilityConnector("throw"),
    provider: "http",
    subreddit: "AskReddit",
    nowIso: "2026-04-22T12:00:00.000Z",
  });

  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /provider failed/);
});

test("createRedditCapabilityProbeConnectorFromEnv disables circuit breaker fallback routing", () => {
  const connector = createRedditCapabilityProbeConnectorFromEnv({
    env: {
      REDDIT_LIVE_PROVIDER: "scrapling",
      REDDIT_CB_ROUTE_TO_FALLBACK: "true",
    },
    mode: "live",
    crawlMode: "live",
  }) as {
    routeToFallbackOnError?: boolean;
    fallbackConnector?: RedditConnector;
  };

  assert.equal(connector.routeToFallbackOnError, false);
  assert.equal(typeof connector.fallbackConnector, "object");
});
