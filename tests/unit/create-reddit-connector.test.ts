import test from "node:test";
import assert from "node:assert/strict";
import {
  createRedditConnector,
  resolveRedditHttpTransport,
  resolveRedditLiveProvider,
  resolveRedditScraplingProfile,
} from "../../src/connectors/reddit/create-reddit-connector";
import { RedditCircuitBreakerConnector } from "../../src/connectors/reddit/reddit-circuit-breaker.connector";
import { RedditHttpConnector } from "../../src/connectors/reddit/reddit-http.connector";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { RedditScraplingConnector } from "../../src/connectors/reddit/reddit-scrapling.connector";

test("resolveRedditLiveProvider defaults to http", () => {
  assert.equal(resolveRedditLiveProvider(undefined), "http");
  assert.equal(resolveRedditLiveProvider("scrapling"), "scrapling");
  assert.equal(resolveRedditLiveProvider("http"), "http");
  assert.equal(resolveRedditLiveProvider("unexpected"), "http");
});

test("resolveRedditHttpTransport defaults to auto", () => {
  assert.equal(resolveRedditHttpTransport(undefined), "auto");
  assert.equal(resolveRedditHttpTransport("fetch"), "fetch");
  assert.equal(resolveRedditHttpTransport("powershell"), "powershell");
  assert.equal(resolveRedditHttpTransport("unexpected"), "auto");
});

test("resolveRedditScraplingProfile defaults to http", () => {
  assert.equal(resolveRedditScraplingProfile(undefined), "http");
  assert.equal(resolveRedditScraplingProfile("dynamic"), "dynamic");
  assert.equal(resolveRedditScraplingProfile("stealth"), "stealth");
  assert.equal(resolveRedditScraplingProfile("unexpected"), "http");
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

test("createRedditConnector supports explicit scrapling provider", () => {
  const connector = createRedditConnector({
    mode: "live",
    liveProvider: "scrapling",
  });
  assert.equal(connector instanceof RedditScraplingConnector, true);
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
