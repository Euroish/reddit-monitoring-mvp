import test from "node:test";
import assert from "node:assert/strict";
import { RedditCircuitBreakerConnector } from "../../src/connectors/reddit/reddit-circuit-breaker.connector";
import { RedditHttpConnector } from "../../src/connectors/reddit/reddit-http.connector";
import { RedditScraplingConnector } from "../../src/connectors/reddit/reddit-scrapling.connector";
import {
  createRedditConnectorFromEnv,
  resolvePhase1CrawlMode,
  resolvePhase1RunMode,
  resolveRedditPhase1CycleOptionsFromEnv,
  upsertActiveSubredditTarget,
} from "../../src/runtime/reddit-phase1-runtime";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
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

test("resolveRedditPhase1CycleOptionsFromEnv defaults backfill to http while keeping mock distinct", () => {
  const backfill = resolveRedditPhase1CycleOptionsFromEnv({
    env: {
      REDDIT_BACKFILL_POST_LIMIT: "120",
      REDDIT_BACKFILL_TARGET_DAYS: "15",
      REDDIT_BACKFILL_MAX_ITERATIONS_PER_TARGET: "9",
    },
    mode: "live",
    crawlMode: "backfill",
  });
  const mock = resolveRedditPhase1CycleOptionsFromEnv({
    env: {},
    mode: "mock",
    crawlMode: "live",
  });

  assert.equal(backfill.providerHint, "http");
  assert.equal(backfill.backfillPostLimit, 120);
  assert.equal(backfill.backfillTargetDays, 15);
  assert.equal(backfill.backfillMaxIterationsPerTarget, 9);
  assert.equal(mock.providerHint, "mock");
});

test("createRedditConnectorFromEnv defaults backfill connector to http when provider is unset", () => {
  const connector = createRedditConnectorFromEnv({
    env: {
      REDDIT_CB_ENABLED: "false",
    },
    mode: "live",
    crawlMode: "backfill",
  });

  assert.equal(connector instanceof RedditHttpConnector, true);
});

test("resolveRedditPhase1CycleOptionsFromEnv applies explicit bounded backfill overrides", () => {
  const options = resolveRedditPhase1CycleOptionsFromEnv({
    env: {
      REDDIT_BACKFILL_PROVIDER: "http",
      REDDIT_BACKFILL_POST_LIMIT: "100",
      REDDIT_BACKFILL_MAX_ITERATIONS_PER_TARGET: "24",
      REDDIT_BACKFILL_TARGET_DAYS: "15",
    },
    mode: "live",
    crawlMode: "backfill",
    backfillPostLimit: 500,
    backfillMaxIterationsPerTarget: 60,
    backfillTargetDays: 20,
  });

  assert.equal(options.backfillPostLimit, 500);
  assert.equal(options.backfillMaxIterationsPerTarget, 60);
  assert.equal(options.backfillTargetDays, 20);
});

test("resolveRedditPhase1CycleOptionsFromEnv keeps bounded backfill defaults when env is absent", () => {
  const options = resolveRedditPhase1CycleOptionsFromEnv({
    env: {
      REDDIT_BACKFILL_PROVIDER: "http",
    },
    mode: "live",
    crawlMode: "backfill",
  });

  assert.equal(options.backfillPostLimit, 100);
  assert.equal(options.backfillMaxIterationsPerTarget, 24);
});

test("resolveRedditPhase1CycleOptionsFromEnv parses target-level scrapling promotion list", () => {
  const options = resolveRedditPhase1CycleOptionsFromEnv({
    env: {
      REDDIT_LIVE_PROVIDER: "http",
      REDDIT_SCRAPLING_PRIMARY_SUBREDDITS: "machinelearning,r/DataScience,machinelearning",
    },
    mode: "live",
    crawlMode: "live",
  });

  assert.deepEqual(options.scraplingPrimaryCanonicalNames, [
    "r/machinelearning",
    "r/datascience",
  ]);
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

test("createRedditConnectorFromEnv passes through dedicated http proxy", () => {
  const connector = createRedditConnectorFromEnv({
    env: {
      REDDIT_HTTP_PROXY: "http://127.0.0.1:1080",
      REDDIT_HTTP_PROXY_FAILOVER_COMMAND: "/usr/local/sbin/reddit-collector-failover",
      REDDIT_CB_ENABLED: "false",
    },
    mode: "live",
    crawlMode: "live",
  });

  assert.equal(connector instanceof RedditHttpConnector, true);
  assert.equal((connector as any).proxyUrl, "http://127.0.0.1:1080");
  assert.equal((connector as any).proxyFailoverCommand, "/usr/local/sbin/reddit-collector-failover");
});

test("createRedditConnectorFromEnv allows provider override per execution target", () => {
  const connector = createRedditConnectorFromEnv({
    env: {
      REDDIT_LIVE_PROVIDER: "http",
      REDDIT_CB_ENABLED: "false",
    },
    mode: "live",
    crawlMode: "live",
    providerOverride: "scrapling",
  });

  assert.equal(connector instanceof RedditScraplingConnector, true);
});

test("createRedditConnectorFromEnv supports scrapling provider and profile", () => {
  const connector = createRedditConnectorFromEnv({
    env: {
      REDDIT_LIVE_PROVIDER: "scrapling",
      REDDIT_SCRAPLING_PROFILE: "stealth",
      REDDIT_SCRAPLING_PYTHON: "py",
      REDDIT_SCRAPLING_BRIDGE_SCRIPT: "scripts/custom_scrapling_bridge.py",
      REDDIT_SCRAPLING_TIMEOUT_MS: "45000",
      REDDIT_SCRAPLING_MAX_RETRIES: "4",
      REDDIT_CB_ENABLED: "false",
    },
    mode: "live",
    crawlMode: "live",
  });

  assert.equal(connector instanceof RedditScraplingConnector, true);
  assert.equal((connector as any).profile, "stealth");
  assert.equal((connector as any).pythonExecutable, "py");
  assert.equal((connector as any).timeoutMs, 45000);
  assert.equal((connector as any).maxRetries, 4);
});

test("createRedditConnectorFromEnv keeps dynamic scrapling primary by default without circuit fallback to http", () => {
  const connector = createRedditConnectorFromEnv({
    env: {
      REDDIT_LIVE_PROVIDER: "scrapling",
      REDDIT_SCRAPLING_PROFILE: "dynamic",
      REDDIT_CB_ENABLED: "true",
      REDDIT_CB_ROUTE_TO_FALLBACK: "true",
    },
    mode: "live",
    crawlMode: "live",
  });

  assert.equal(connector instanceof RedditCircuitBreakerConnector, true);
  assert.equal((connector as any).routeToFallbackOnError, false);
});

test("createRedditConnectorFromEnv allows explicit dynamic scrapling circuit fallback to http via env", () => {
  const connector = createRedditConnectorFromEnv({
    env: {
      REDDIT_LIVE_PROVIDER: "scrapling",
      REDDIT_SCRAPLING_PROFILE: "dynamic",
      REDDIT_SCRAPLING_CB_ROUTE_TO_HTTP: "true",
      REDDIT_CB_ENABLED: "true",
      REDDIT_CB_ROUTE_TO_FALLBACK: "true",
    },
    mode: "live",
    crawlMode: "live",
  });

  assert.equal(connector instanceof RedditCircuitBreakerConnector, true);
  assert.equal((connector as any).routeToFallbackOnError, true);
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

test("upsertActiveSubredditTarget preserves existing monitor target config", async () => {
  const monitorTargetRepository = new InMemoryMonitorTargetRepository();
  await monitorTargetRepository.upsert({
    id: stableUuidFromString("reddit:target:r/datascience"),
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/datascience",
    status: "paused",
    config: {
      collection: {
        live: {
          favorite: true,
          cadenceHours: 8,
        },
      },
    },
    createdAt: "2026-04-14T00:00:00.000Z",
    updatedAt: "2026-04-14T00:00:00.000Z",
  });

  await upsertActiveSubredditTarget({
    monitorTargetRepository,
    subreddit: "datascience",
    nowIso: "2026-04-15T00:00:00.000Z",
  });

  const stored = await monitorTargetRepository.findByCanonicalName("r/datascience");
  assert.deepEqual(stored?.config, {
    collection: {
      live: {
        favorite: true,
        cadenceHours: 8,
      },
    },
  });
  assert.equal(stored?.status, "active");
  assert.equal(stored?.createdAt, "2026-04-14T00:00:00.000Z");
});
