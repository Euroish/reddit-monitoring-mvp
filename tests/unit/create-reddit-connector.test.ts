import test from "node:test";
import assert from "node:assert/strict";
import {
  createRedditConnector,
  resolveRedditHttpTransport,
  resolveRedditLiveProvider,
} from "../../src/connectors/reddit/create-reddit-connector";
import { RedditApifyConnector } from "../../src/connectors/reddit/reddit-apify.connector";
import { RedditCircuitBreakerConnector } from "../../src/connectors/reddit/reddit-circuit-breaker.connector";
import { RedditHttpConnector } from "../../src/connectors/reddit/reddit-http.connector";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";

test("resolveRedditLiveProvider defaults to http", () => {
  assert.equal(resolveRedditLiveProvider(undefined), "http");
  assert.equal(resolveRedditLiveProvider("apify"), "apify");
  assert.equal(resolveRedditLiveProvider("http"), "http");
  assert.equal(resolveRedditLiveProvider("unexpected"), "http");
});

test("resolveRedditHttpTransport defaults to auto", () => {
  assert.equal(resolveRedditHttpTransport(undefined), "auto");
  assert.equal(resolveRedditHttpTransport("fetch"), "fetch");
  assert.equal(resolveRedditHttpTransport("powershell"), "powershell");
  assert.equal(resolveRedditHttpTransport("unexpected"), "auto");
});

test("createRedditConnector uses http as live default", () => {
  const connector = createRedditConnector({ mode: "live" });
  assert.equal(connector instanceof RedditHttpConnector, true);
});

test("createRedditConnector supports explicit http provider", () => {
  const connector = createRedditConnector({
    mode: "live",
    liveProvider: "http",
  });
  assert.equal(connector instanceof RedditHttpConnector, true);
});

test("createRedditConnector supports explicit apify provider", () => {
  const connector = createRedditConnector({
    mode: "live",
    liveProvider: "apify",
  });
  assert.equal(connector instanceof RedditApifyConnector, true);
});

test("createRedditConnector keeps mock mode behavior", () => {
  const connector = createRedditConnector({ mode: "mock" });
  assert.equal(connector instanceof RedditMockConnector, true);
});

test("createRedditConnector can wrap live connector with circuit breaker", () => {
  const connector = createRedditConnector({
    mode: "live",
    circuitBreaker: {
      enabled: true,
    },
  });
  assert.equal(connector instanceof RedditCircuitBreakerConnector, true);
});
