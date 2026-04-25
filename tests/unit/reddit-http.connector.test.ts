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

test("http connector routes requests through configured proxy without global fetch", async () => {
  const originalFetch = global.fetch;
  try {
    let proxyCallCount = 0;
    global.fetch = (async () => {
      throw new Error("fetch should not be called when proxyUrl is configured");
    }) as FetchLike;

    const connector = new RedditHttpConnector({
      proxyUrl: "socks5h://127.0.0.1:1080",
      maxRetries: 1,
      jitterRatio: 0,
      proxyRunner: async (args) => {
        proxyCallCount += 1;
        assert.equal(args.proxyUrl, "socks5h://127.0.0.1:1080");
        assert.equal(args.url, "https://www.reddit.com/r/datascience/about.json");
        assert.equal(args.headers["User-Agent"], "reddit-monitoring-mvp/0.1");
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
    });

    const result = await connector.collectSubredditAbout({ subreddit: "datascience" }, ctx);
    assert.equal(result.raw.httpStatus, 200);
    assert.equal(proxyCallCount, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("http connector triggers one proxy failover on blocked proxied response and retries request", async () => {
  const originalFetch = global.fetch;
  try {
    let proxyCallCount = 0;
    const failoverCalls: Array<{ command: string; endpoint: string; reason: string }> = [];
    global.fetch = (async () => {
      throw new Error("fetch should not be called when proxyUrl is configured");
    }) as FetchLike;

    const connector = new RedditHttpConnector({
      proxyUrl: "http://127.0.0.1:1080",
      proxyFailoverCommand: "/usr/local/sbin/reddit-collector-failover",
      maxRetries: 0,
      proxyFailoverRunner: async (args) => {
        failoverCalls.push(args);
      },
      proxyRunner: async () => {
        proxyCallCount += 1;
        if (proxyCallCount === 1) {
          return {
            status: 403,
            headers: {} as Record<string, string>,
            body: "<html>blocked by network security, use your developer token</html>",
          };
        }
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
    });

    const result = await connector.collectSubredditAbout({ subreddit: "datascience" }, ctx);
    assert.equal(result.raw.httpStatus, 200);
    assert.equal(proxyCallCount, 2);
    assert.deepEqual(failoverCalls, [
      {
        command: "/usr/local/sbin/reddit-collector-failover",
        endpoint: "/r/datascience/about.json",
        reason: "status=403",
      },
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("http connector does not fail over on semantic reddit 403 responses", async () => {
  const originalFetch = global.fetch;
  try {
    const failoverCalls: Array<{ command: string; endpoint: string; reason: string }> = [];
    global.fetch = (async () => {
      throw new Error("fetch should not be called when proxyUrl is configured");
    }) as FetchLike;

    const connector = new RedditHttpConnector({
      proxyUrl: "http://127.0.0.1:1080",
      proxyFailoverCommand: "/usr/local/sbin/reddit-collector-failover",
      maxRetries: 0,
      proxyFailoverRunner: async (args) => {
        failoverCalls.push(args);
      },
      proxyRunner: async () => ({
        status: 403,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reason: "private",
          message: "Forbidden",
          error: 403,
        }),
      }),
    });

    await assert.rejects(
      () => connector.collectSubredditAbout({ subreddit: "one" }, ctx),
      /status=403/,
    );
    assert.deepEqual(failoverCalls, []);
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
