import test from "node:test";
import assert from "node:assert/strict";
import { RedditCircuitBreakerConnector } from "../../src/connectors/reddit/reddit-circuit-breaker.connector";
import type { RedditConnector } from "../../src/connectors/reddit/reddit-connector.interface";
import type { ConnectorRequestContext } from "../../src/connectors/shared/connector.interface";
import type {
  RedditAboutPayload,
  RedditCollectSubredditAboutArgs,
  RedditCollectSubredditPostsArgs,
  RedditListingPayload,
  RedditPostData,
} from "../../src/connectors/reddit/reddit.types";

const ctx: ConnectorRequestContext = {
  requestId: "req-cb-test",
  now: "2026-04-14T10:00:00.000Z",
};

class StubRedditConnector implements RedditConnector {
  public readonly sourceCode = "reddit" as const;
  public aboutCalls = 0;
  public postCalls = 0;
  public healthCalls = 0;
  public failAbout = false;
  public failPosts = false;
  public failHealth = false;

  public async collect(
    args: RedditCollectSubredditPostsArgs,
    requestContext: ConnectorRequestContext,
  ) {
    return this.collectSubredditPosts(args, requestContext);
  }

  public async collectSubredditAbout(
    args: RedditCollectSubredditAboutArgs,
    _requestContext: ConnectorRequestContext,
  ) {
    this.aboutCalls += 1;
    if (this.failAbout) {
      throw new Error("about failed");
    }
    const payload: RedditAboutPayload = {
      data: {
        display_name: args.subreddit,
        subscribers: 1000,
        accounts_active: 10,
      },
    };
    return {
      raw: {
        endpoint: `/r/${args.subreddit}/about.json`,
        requestParams: { subreddit: args.subreddit },
        httpStatus: 200,
        responseHeaders: {},
        payload,
        fetchedAt: new Date().toISOString(),
      },
    };
  }

  public async collectSubredditPosts(
    args: RedditCollectSubredditPostsArgs,
    _requestContext: ConnectorRequestContext,
  ) {
    this.postCalls += 1;
    if (this.failPosts) {
      throw new Error("posts failed");
    }
    const payload: RedditListingPayload<RedditPostData> = {
      data: {
        after: undefined,
        children: [],
      },
    };
    return {
      raw: {
        endpoint: `/r/${args.subreddit}/new.json`,
        requestParams: {
          subreddit: args.subreddit,
          limit: args.limit,
        },
        httpStatus: 200,
        responseHeaders: {},
        payload,
        fetchedAt: new Date().toISOString(),
      },
      nextCursor: undefined,
    };
  }

  public async healthCheck(_requestContext: ConnectorRequestContext): Promise<boolean> {
    this.healthCalls += 1;
    return !this.failHealth;
  }
}

test("circuit breaker opens on repeated failures and recovers after reset timeout", async () => {
  const primary = new StubRedditConnector();
  primary.failPosts = true;

  const connector = new RedditCircuitBreakerConnector(primary, {
    timeoutMs: 500,
    errorThresholdPercentage: 1,
    volumeThreshold: 1,
    resetTimeoutMs: 40,
    routeToFallbackOnError: false,
  });

  await assert.rejects(
    connector.collectSubredditPosts({ subreddit: "datascience", limit: 10 }, ctx),
    /posts failed/,
  );
  assert.equal(primary.postCalls, 1);
  assert.equal(connector.getCircuitState(), "open");

  await assert.rejects(
    connector.collectSubredditPosts({ subreddit: "datascience", limit: 10 }, ctx),
    /provider\.circuit_open/,
  );
  assert.equal(primary.postCalls, 1);

  primary.failPosts = false;
  await new Promise((resolve) => setTimeout(resolve, 60));
  const recovered = await connector.collectSubredditPosts(
    { subreddit: "datascience", limit: 10 },
    ctx,
  );
  assert.equal(recovered.raw.httpStatus, 200);
  assert.equal(primary.postCalls, 2);
  assert.equal(connector.getCircuitState(), "closed");
});

test("circuit breaker routes to fallback connector when primary fails or circuit is open", async () => {
  const primary = new StubRedditConnector();
  primary.failPosts = true;
  const fallback = new StubRedditConnector();

  const connector = new RedditCircuitBreakerConnector(primary, {
    timeoutMs: 500,
    errorThresholdPercentage: 1,
    volumeThreshold: 1,
    resetTimeoutMs: 1000,
    routeToFallbackOnError: true,
    fallbackConnector: fallback,
  });

  const first = await connector.collectSubredditPosts(
    { subreddit: "machinelearning", limit: 10 },
    ctx,
  );
  assert.equal(first.raw.httpStatus, 200);
  assert.equal(first.raw.responseHeaders["x-provider-fallback"], "circuit_breaker");
  assert.equal(first.raw.responseHeaders["x-provider-fallback-reason"], "provider_error");
  assert.equal(primary.postCalls, 1);
  assert.equal(fallback.postCalls, 1);

  const second = await connector.collectSubredditPosts(
    { subreddit: "machinelearning", limit: 10 },
    ctx,
  );
  assert.equal(second.raw.httpStatus, 200);
  assert.equal(second.raw.responseHeaders["x-provider-fallback"], "circuit_breaker");
  assert.equal(second.raw.responseHeaders["x-provider-fallback-reason"], "circuit_open");
  assert.equal(primary.postCalls, 1);
  assert.equal(fallback.postCalls, 2);

  const health = await connector.healthCheck(ctx);
  assert.equal(health, true);
  assert.equal(primary.healthCalls, 0);
  assert.equal(fallback.healthCalls, 1);
});

