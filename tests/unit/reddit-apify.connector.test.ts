import test from "node:test";
import assert from "node:assert/strict";
import { RedditApifyConnector } from "../../src/connectors/reddit/reddit-apify.connector";
import type { ConnectorRequestContext } from "../../src/connectors/shared/connector.interface";

type FetchLike = typeof fetch;

const ctx: ConnectorRequestContext = {
  requestId: "req-apify-test",
  now: "2026-04-13T10:00:00.000Z",
};

function createJsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

test("apify connector collects subreddit posts via actor run + dataset", async () => {
  const originalFetch = global.fetch;
  const calls: Array<{
    url: string;
    method: string;
    authHeader?: string | null;
    body?: string | undefined;
  }> = [];
  try {
    global.fetch = (async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        method: init?.method ?? "GET",
        authHeader: headers.get("authorization"),
        body: typeof init?.body === "string" ? init.body : undefined,
      });

      if (url.includes("/acts/") && url.endsWith("/runs")) {
        return createJsonResponse(
          {
            data: {
              id: "run-1",
              status: "RUNNING",
            },
          },
          201,
        );
      }
      if (url.includes("/actor-runs/run-1?waitForFinish=")) {
        return createJsonResponse({
          data: {
            id: "run-1",
            status: "SUCCEEDED",
            defaultDatasetId: "dataset-1",
          },
        });
      }
      if (url.includes("/actor-runs/run-1/dataset/items")) {
        return createJsonResponse([
          {
            id: "abc123",
            subreddit: "machinelearning",
            author: "alice",
            title: "A useful paper",
            selftext: "details",
            permalink: "/r/machinelearning/comments/abc123/a_useful_paper/",
            created_utc: 1_712_500_000,
            score: 42,
            num_comments: 8,
            upvote_ratio: 0.91,
            url: "https://www.reddit.com/r/machinelearning/comments/abc123/a_useful_paper/",
          },
        ]);
      }
      return createJsonResponse({}, 404);
    }) as FetchLike;

    const connector = new RedditApifyConnector({
      actorRunEndpoint: "https://api.apify.com/v2/acts/example~reddit-scraper/runs",
      token: "apify-token",
      fallbackOnError: false,
    });

    const page = await connector.collectSubredditPosts(
      {
        subreddit: "machinelearning",
        limit: 20,
      },
      ctx,
    );

    assert.equal(page.raw.responseHeaders["x-provider"], "apify");
    assert.equal(page.raw.payload.data.children.length, 1);
    assert.equal(page.raw.payload.data.children[0]?.data.name, "t3_abc123");
    assert.equal(page.raw.payload.data.children[0]?.data.author, "alice");
    assert.equal(page.raw.payload.data.children[0]?.data.num_comments, 8);
    assert.equal(calls.length, 3);
    assert.equal(calls[0]?.method, "POST");
    assert.equal(calls[0]?.authHeader, "Bearer apify-token");
    assert.match(calls[1]?.url ?? "", /waitForFinish=/);
    const inputBody = JSON.parse(calls[0]?.body ?? "{}") as {
      startUrls?: Array<{ url?: string }>;
      maxPosts?: number;
      sortBy?: string;
      scrapePosts?: boolean;
      scrapeComments?: boolean;
      scrapeUsers?: boolean;
    };
    assert.deepEqual(inputBody.startUrls, [
      { url: "https://www.reddit.com/r/machinelearning/" },
    ]);
    assert.equal(inputBody.maxPosts, 20);
    assert.equal(inputBody.sortBy, "new");
    assert.equal(inputBody.scrapePosts, true);
    assert.equal(inputBody.scrapeComments, false);
    assert.equal(inputBody.scrapeUsers, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("apify connector falls back to http connector when run endpoint is missing", async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = (async (input) => {
      const url = String(input);
      if (url.includes("/r/machinelearning/new.json")) {
        return createJsonResponse({
          data: {
            after: null,
            children: [
              {
                kind: "t3",
                data: {
                  name: "t3_http1",
                  id: "http1",
                  subreddit: "machinelearning",
                  author: "bob",
                  title: "http fallback post",
                  selftext: "",
                  url: "https://www.reddit.com/r/machinelearning/comments/http1/post/",
                  permalink: "/r/machinelearning/comments/http1/post/",
                  created_utc: 1_712_500_100,
                  score: 5,
                  num_comments: 1,
                  upvote_ratio: 0.8,
                },
              },
            ],
          },
        });
      }
      return createJsonResponse({}, 404);
    }) as FetchLike;

    const connector = new RedditApifyConnector({
      fallbackOnError: true,
    });
    const page = await connector.collectSubredditPosts(
      {
        subreddit: "machinelearning",
        limit: 10,
      },
      ctx,
    );
    assert.equal(page.raw.payload.data.children.length, 1);
    assert.equal(page.raw.payload.data.children[0]?.data.name, "t3_http1");
  } finally {
    global.fetch = originalFetch;
  }
});

test("apify connector classifies rate-limit failures", async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = (async (input) => {
      const url = String(input);
      if (url.includes("/acts/") && url.endsWith("/runs")) {
        return createJsonResponse(
          {
            error: {
              type: "rate-limit-exceeded",
              message: "quota exceeded",
            },
          },
          429,
        );
      }
      return createJsonResponse({}, 404);
    }) as FetchLike;

    const connector = new RedditApifyConnector({
      actorRunEndpoint: "https://api.apify.com/v2/acts/example~reddit-scraper/runs",
      token: "apify-token",
      fallbackOnError: false,
    });

    await assert.rejects(
      connector.collectSubredditPosts(
        {
          subreddit: "machinelearning",
          limit: 10,
        },
        ctx,
      ),
      /apify\.rate_limit/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});
