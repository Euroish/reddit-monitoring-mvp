import test from "node:test";
import assert from "node:assert/strict";
import { RedditHttpConnector } from "../../src/connectors/reddit/reddit-http.connector";
import {
  createRedditConnectorFromEnv,
  resolvePhase1CrawlMode,
  resolvePhase1RunMode,
  resolveRedditPhase1CycleOptionsFromEnv,
  upsertActiveSubredditTarget,
} from "../../src/runtime/reddit-phase1-runtime";
import { InMemoryMonitorTargetRepository } from "../../src/storage/repositories/in-memory/in-memory.repositories";

test("resolveRedditPhase1CycleOptionsFromEnv keeps http-first live defaults aligned", () => {
  const options = resolveRedditPhase1CycleOptionsFromEnv({
    env: {
      REDDIT_LIVE_PROVIDER: "http",
      REDDIT_POST_LIMIT_BASE: "18",
      REDDIT_POST_LIMIT_BOOST: "42",
      REDDIT_POST_LIMIT_ADAPTIVE: "true",
      REDDIT_CANDIDATE_FILTER_MODE: "and",
      REDDIT_CANDIDATE_MIN_SCORE: "7",
      REDDIT_CANDIDATE_MIN_COMMENTS: "3",
    },
    mode: "live",
    crawlMode: "live",
    targetCanonicalNames: ["r/datascience"],
    continueOnError: true,
  });

  assert.deepEqual(options.targetCanonicalNames, ["r/datascience"]);
  assert.equal(options.basePostLimit, 18);
  assert.equal(options.boostPostLimit, 42);
  assert.equal(options.crawlMode, "live");
  assert.equal(options.providerHint, "http");
  assert.equal(options.postCandidateMinScore, 7);
  assert.equal(options.postCandidateMinComments, 3);
  assert.equal(options.postCandidateFilterMode, "and");
  assert.equal(options.disableAdaptiveSampling, false);
  assert.equal(options.continueOnError, true);
});

test("resolveRedditPhase1CycleOptionsFromEnv keeps backfill provider and mock provider distinct", () => {
  const backfill = resolveRedditPhase1CycleOptionsFromEnv({
    env: {
      REDDIT_BACKFILL_PROVIDER: "apify",
    },
    mode: "live",
    crawlMode: "backfill",
  });
  const mock = resolveRedditPhase1CycleOptionsFromEnv({
    env: {},
    mode: "mock",
    crawlMode: "live",
  });

  assert.equal(backfill.providerHint, "apify");
  assert.equal(mock.providerHint, "mock");
});

test("phase1 mode and crawl mode resolvers default to mock for safe local iteration", () => {
  assert.equal(resolvePhase1RunMode("mock"), "mock");
  assert.equal(resolvePhase1RunMode("live"), "live");
  assert.equal(resolvePhase1RunMode("unexpected"), "mock");
  assert.equal(resolvePhase1RunMode(undefined), "mock");
  assert.equal(resolvePhase1CrawlMode("backfill"), "backfill");
  assert.equal(resolvePhase1CrawlMode("unexpected"), "live");
});

test("createRedditConnectorFromEnv passes through http transport override", () => {
  const connector = createRedditConnectorFromEnv({
    env: {
      REDDIT_HTTP_TRANSPORT: "powershell",
      REDDIT_CB_ENABLED: "false",
    },
    mode: "live",
    crawlMode: "live",
  });

  assert.equal(connector instanceof RedditHttpConnector, true);
  assert.equal((connector as any).transport, "powershell");
});

test("createRedditConnectorFromEnv passes through http timeout override", () => {
  const connector = createRedditConnectorFromEnv({
    env: {
      REDDIT_HTTP_TIMEOUT_MS: "30000",
      REDDIT_CB_ENABLED: "false",
    },
    mode: "live",
    crawlMode: "live",
  });

  assert.equal(connector instanceof RedditHttpConnector, true);
  assert.equal((connector as any).timeoutMs, 30000);
});

test("upsertActiveSubredditTarget normalizes canonical naming once", async () => {
  const monitorTargetRepository = new InMemoryMonitorTargetRepository();
  const result = await upsertActiveSubredditTarget({
    monitorTargetRepository,
    subreddit: "R/DataScience",
    nowIso: "2026-04-15T00:00:00.000Z",
  });

  assert.equal(result.canonicalName, "r/datascience");
  const stored = await monitorTargetRepository.findByCanonicalName("r/datascience");
  assert.equal(stored?.canonicalName, "r/datascience");
});
