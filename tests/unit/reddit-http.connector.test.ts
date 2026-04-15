import test from "node:test";
import assert from "node:assert/strict";
import { RedditHttpConnector } from "../../src/connectors/reddit/reddit-http.connector";
import type { ConnectorRequestContext } from "../../src/connectors/shared/connector.interface";

const ctx: ConnectorRequestContext = {
  requestId: "req-test",
  now: "2026-04-11T08:00:00.000Z",
};

type FetchLike = typeof fetch;

function createAboutResponse(status = 200, headers?: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      data: {
        display_name: "datascience",
        name: "t5_datascience",
        subscribers: 1000,
        accounts_active: 50,
      },
    }),
    {
      status,
      headers: {
        "content-type": "application/json",
        ...(headers ?? {}),
      },
    },
  );
}

test("http connector uses oauth base url and authorization header when token provided", async () => {
  const originalFetch = global.fetch;
  try {
    let calledUrl = "";
    let calledHeaders: HeadersInit | undefined;
    global.fetch = (async (input, init) => {
      calledUrl = String(input);
      calledHeaders = init?.headers;
      return createAboutResponse(200);
    }) as FetchLike;

    const connector = new RedditHttpConnector({
      accessToken: "token-abc",
      jitterRatio: 0,
    });

    const result = await connector.collectSubredditAbout({ subreddit: "datascience" }, ctx);
    assert.equal(result.raw.httpStatus, 200);
    assert.equal(calledUrl.startsWith("https://oauth.reddit.com/r/datascience/about.json"), true);

    const headers = new Headers(calledHeaders);
    assert.equal(headers.get("authorization"), "Bearer token-abc");
    assert.equal(headers.get("x-request-id"), "req-test");
    assert.equal(headers.get("user-agent"), "reddit-monitoring-mvp/0.1");
  } finally {
    global.fetch = originalFetch;
  }
});

test("http connector retries 429 with Retry-After and then succeeds", async () => {
  const originalFetch = global.fetch;
  try {
    let callCount = 0;
    const sleepCalls: number[] = [];
    global.fetch = (async () => {
      callCount += 1;
      if (callCount === 1) {
        return createAboutResponse(429, { "retry-after": "1" });
      }
      return createAboutResponse(200);
    }) as FetchLike;

    const connector = new RedditHttpConnector({
      maxRetries: 3,
      jitterRatio: 0,
    });
    (connector as any).sleep = async (ms: number) => {
      sleepCalls.push(ms);
    };

    const result = await connector.collectSubredditAbout({ subreddit: "datascience" }, ctx);
    assert.equal(result.raw.httpStatus, 200);
    assert.equal(callCount, 2);
    assert.deepEqual(sleepCalls, [1000]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("http connector retries network TypeError before succeeding", async () => {
  const originalFetch = global.fetch;
  try {
    let callCount = 0;
    const sleepCalls: number[] = [];
    global.fetch = (async () => {
      callCount += 1;
      if (callCount === 1) {
        throw new TypeError("network fail");
      }
      return createAboutResponse(200);
    }) as FetchLike;

    const connector = new RedditHttpConnector({
      maxRetries: 2,
      backoffBaseMs: 500,
      jitterRatio: 0,
    });
    (connector as any).sleep = async (ms: number) => {
      sleepCalls.push(ms);
    };

    const result = await connector.collectSubredditAbout({ subreddit: "datascience" }, ctx);
    assert.equal(result.raw.httpStatus, 200);
    assert.equal(callCount, 2);
    assert.deepEqual(sleepCalls, [500]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("http connector does not retry non-retryable status", async () => {
  const originalFetch = global.fetch;
  try {
    let callCount = 0;
    global.fetch = (async () => {
      callCount += 1;
      return createAboutResponse(400);
    }) as FetchLike;

    const connector = new RedditHttpConnector({
      maxRetries: 3,
      jitterRatio: 0,
    });
    await assert.rejects(
      connector.collectSubredditAbout({ subreddit: "datascience" }, ctx),
      /status=400/,
    );
    assert.equal(callCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("http connector falls back to PowerShell on Windows ECONNRESET", async () => {
  const originalFetch = global.fetch;
  try {
    let fetchCallCount = 0;
    let powershellCallCount = 0;
    global.fetch = (async () => {
      fetchCallCount += 1;
      throw new TypeError("fetch failed", {
        cause: {
          code: "ECONNRESET",
        },
      } as ErrorOptions);
    }) as FetchLike;

    const connector = new RedditHttpConnector({
      platform: "win32",
      transport: "auto",
      powershellRunner: async () => {
        powershellCallCount += 1;
        return {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            data: {
              display_name: "datascience",
              name: "t5_datascience",
              subscribers: 1000,
              accounts_active: 50,
            },
          }),
        };
      },
      jitterRatio: 0,
    });

    const result = await connector.collectSubredditAbout({ subreddit: "datascience" }, ctx);
    assert.equal(result.raw.httpStatus, 200);
    assert.equal(fetchCallCount, 1);
    assert.equal(powershellCallCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});
