import test from "node:test";
import assert from "node:assert/strict";
import {
  RedditScraplingConnector,
  type RedditScraplingProfile,
} from "../../src/connectors/reddit/reddit-scrapling.connector";
import type { ConnectorRequestContext } from "../../src/connectors/shared/connector.interface";

const ctx: ConnectorRequestContext = {
  requestId: "req-scrapling-test",
  now: "2026-04-16T00:00:00.000Z",
};

test("scrapling connector maps listing payload and provider header", async () => {
  const connector = new RedditScraplingConnector({
    profile: "http",
    bridgeRunner: async () => ({
      ok: true,
      status: 200,
      headers: {
        "content-type": "application/json",
      },
      json: {
        data: {
          after: "t3_after",
          children: [
            {
              kind: "t3",
              data: {
                name: "t3_abc",
                id: "abc",
                subreddit: "datascience",
                author: "tester",
                title: "hello",
                permalink: "/r/datascience/comments/abc/hello",
                created_utc: 1710000000,
              },
            },
          ],
        },
      },
      fetchedAt: "2026-04-16T00:00:00.000Z",
    }),
  });

  const page = await connector.collectSubredditPosts(
    {
      subreddit: "datascience",
      limit: 10,
    },
    ctx,
  );

  assert.equal(page.raw.httpStatus, 200);
  assert.equal(page.nextCursor, "t3_after");
  assert.equal(page.raw.responseHeaders["x-provider"], "scrapling");
  assert.equal(page.raw.responseHeaders["x-scrapling-profile"], "http");
  assert.equal(
    page.raw.responseHeaders["x-scrapling-session-key"],
    "reddit:http:/r/datascience/new.json",
  );
  assert.equal(page.raw.responseHeaders["x-scrapling-session-key-reused"], "0");
  assert.equal(page.raw.payload.data.children.length, 1);
});

test("scrapling connector ignores multiline set-cookie headers from bridge", async () => {
  const connector = new RedditScraplingConnector({
    profile: "dynamic",
    bridgeRunner: async () => ({
      ok: true,
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie":
          "loid=abc; Domain=reddit.com\r\nsession_tracker=xyz; Domain=reddit.com",
      },
      json: {
        data: {
          display_name: "datascience",
        },
      },
      fetchedAt: "2026-04-16T00:00:00.000Z",
    }),
  });

  const page = await connector.collectSubredditAbout(
    {
      subreddit: "datascience",
    },
    ctx,
  );

  assert.equal(page.raw.httpStatus, 200);
  assert.equal(page.raw.responseHeaders["set-cookie"], undefined);
  assert.equal(page.raw.responseHeaders["x-provider"], "scrapling");
});

test("scrapling connector marks logical session-key reuse on repeated calls", async () => {
  const subreddit = `datascience_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const connector = new RedditScraplingConnector({
    profile: "dynamic",
    bridgeRunner: async () => ({
      ok: true,
      status: 200,
      headers: {
        "content-type": "application/json",
      },
      json: {
        data: {
          display_name: "datascience",
        },
      },
      fetchedAt: "2026-04-16T00:00:00.000Z",
    }),
  });

  const first = await connector.collectSubredditAbout(
    {
      subreddit,
    },
    ctx,
  );
  const second = await connector.collectSubredditAbout(
    {
      subreddit,
    },
    ctx,
  );

  assert.equal(
    first.raw.responseHeaders["x-scrapling-session-key"],
    `reddit:dynamic:/r/${subreddit}/about.json`,
  );
  assert.equal(first.raw.responseHeaders["x-scrapling-session-key-reused"], "0");
  assert.equal(second.raw.responseHeaders["x-scrapling-session-key-reused"], "1");
});

test("scrapling connector keeps session-key reuse across connector instances in one process", async () => {
  const subreddit = `sessionkey_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const createConnector = () =>
    new RedditScraplingConnector({
      profile: "http",
      bridgeRunner: async () => ({
        ok: true,
        status: 200,
        headers: {
          "content-type": "application/json",
        },
        json: {
          data: {
            display_name: subreddit,
          },
        },
        fetchedAt: "2026-04-16T00:00:00.000Z",
      }),
    });

  const first = await createConnector().collectSubredditAbout(
    {
      subreddit,
    },
    ctx,
  );
  const second = await createConnector().collectSubredditAbout(
    {
      subreddit,
    },
    ctx,
  );

  assert.equal(first.raw.responseHeaders["x-scrapling-session-key-reused"], "0");
  assert.equal(second.raw.responseHeaders["x-scrapling-session-key-reused"], "1");
});

test("scrapling connector retries retryable status", async () => {
  let callCount = 0;
  const sleepCalls: number[] = [];
  const connector = new RedditScraplingConnector({
    profile: "dynamic",
    maxRetries: 2,
    jitterRatio: 0,
    bridgeRunner: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          ok: true,
          status: 429,
          headers: {
            "retry-after": "1",
          } as Record<string, string>,
          bodyText: "{\"error\":\"rate limited\"}",
          fetchedAt: "2026-04-16T00:00:00.000Z",
        };
      }
      return {
        ok: true,
        status: 200,
        headers: {
          "content-type": "application/json",
        } as Record<string, string>,
        bodyText: JSON.stringify({
          data: {
            display_name: "datascience",
          },
        }),
        fetchedAt: "2026-04-16T00:00:01.000Z",
      };
    },
  });
  (connector as any).sleep = async (ms: number) => {
    sleepCalls.push(ms);
  };

  const result = await connector.collectSubredditAbout(
    {
      subreddit: "datascience",
    },
    ctx,
  );

  assert.equal(result.raw.httpStatus, 200);
  assert.equal(callCount, 2);
  assert.deepEqual(sleepCalls, [1000]);
});

test("scrapling connector fails fast when bridge returns no JSON payload", async () => {
  const connector = new RedditScraplingConnector({
    bridgeRunner: async () => ({
      ok: true,
      status: 200,
      headers: {},
      fetchedAt: "2026-04-16T00:00:00.000Z",
    }),
  });

  await assert.rejects(
    connector.collectSubredditAbout(
      {
        subreddit: "datascience",
      },
      ctx,
    ),
    /payload is missing/,
  );
});

test("scrapling connector accepts all supported profiles", () => {
  const profiles: RedditScraplingProfile[] = ["http", "dynamic", "stealth"];
  for (const profile of profiles) {
    const connector = new RedditScraplingConnector({
      profile,
      bridgeRunner: async () => ({
        ok: true,
        status: 200,
        headers: {},
        bodyText: JSON.stringify({
          data: { display_name: "datascience" },
        }),
      }),
    });
    assert.equal((connector as any).profile, profile);
  }
});
