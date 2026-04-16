import assert from "node:assert/strict";
import test from "node:test";
import { createApiServer } from "../../apps/api/src/create-api-server";
import { READYZ_THRESHOLDS } from "../../apps/api/src/readyz-thresholds";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  createApiTestRepositories,
  getJson,
  startServer,
  stopServer,
} from "./api-server.helpers";

test("api server readyz returns queue backlog and active sessions", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetId = stableUuidFromString("reddit:target:r/datascience");

  await repos.monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/datascience",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });

  await repos.collectionJobRepository.create({
    id: stableUuidFromString("job:queued:due"),
    source: "reddit",
    targetId,
    jobType: "collect_subreddit_new_posts",
    crawlMode: "live",
    status: "queued",
    scheduledAt: "2026-04-10T11:00:00.000Z",
    dedupeKey: "queued-due",
    retryCount: 0,
  });
  await repos.collectionJobRepository.create({
    id: stableUuidFromString("job:queued:delayed"),
    source: "reddit",
    targetId,
    jobType: "collect_subreddit_about",
    crawlMode: "backfill",
    status: "queued",
    scheduledAt: "2026-04-10T11:30:00.000Z",
    nextRunAt: "2026-04-10T12:30:00.000Z",
    dedupeKey: "queued-delayed",
    retryCount: 0,
  });
  await repos.collectionJobRepository.create({
    id: stableUuidFromString("job:retrying:due"),
    source: "reddit",
    targetId,
    jobType: "collect_subreddit_new_posts",
    crawlMode: "live",
    status: "retrying",
    scheduledAt: "2026-04-10T10:00:00.000Z",
    nextRunAt: "2026-04-10T11:59:00.000Z",
    dedupeKey: "retrying-due",
    retryCount: 1,
  });
  await repos.collectionJobRepository.create({
    id: stableUuidFromString("job:running"),
    source: "reddit",
    targetId,
    jobType: "build_subreddit_trend_points",
    crawlMode: "backfill",
    status: "running",
    scheduledAt: "2026-04-10T10:30:00.000Z",
    startedAt: "2026-04-10T11:45:00.000Z",
    dedupeKey: "running",
    retryCount: 0,
  });
  await repos.collectionJobRepository.create({
    id: stableUuidFromString("job:dead-letter"),
    source: "reddit",
    targetId,
    jobType: "collect_subreddit_about",
    status: "dead_letter",
    scheduledAt: "2026-04-10T08:00:00.000Z",
    deadLetteredAt: "2026-04-10T09:00:00.000Z",
    dedupeKey: "dead-letter",
    retryCount: 3,
  });

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const readyResult = await getJson<{
      ok: boolean;
      status: string;
      checks: {
        storage: string;
        queue: string;
      };
      queue: {
        backlog: number;
        scheduled: number;
        running: number;
        deadLetter: number;
        byMode: {
          live: { backlog: number };
          backfill: { scheduled: number; running: number };
          default: { deadLetter: number };
        };
      };
      observability: {
        fetchSuccessRate: number | null;
      };
      activeSessions: number;
      activeTargets: number;
      degradedReasons: string[];
    }>(`${baseUrl}/readyz`);

    assert.equal(readyResult.status, 200);
    assert.equal(readyResult.body.ok, true);
    assert.equal(readyResult.body.status, "degraded");
    assert.equal(readyResult.body.checks.storage, "ok");
    assert.equal(readyResult.body.checks.queue, "degraded");
    assert.equal(readyResult.body.queue.backlog, 2);
    assert.equal(readyResult.body.queue.scheduled, 1);
    assert.equal(readyResult.body.queue.running, 1);
    assert.equal(readyResult.body.queue.deadLetter, 1);
    assert.equal(readyResult.body.queue.byMode.live.backlog, 2);
    assert.equal(readyResult.body.queue.byMode.backfill.scheduled, 1);
    assert.equal(readyResult.body.queue.byMode.backfill.running, 1);
    assert.equal(readyResult.body.queue.byMode.default.deadLetter, 1);
    assert.equal(readyResult.body.observability.fetchSuccessRate, null);
    assert.equal(readyResult.body.activeSessions, 0);
    assert.equal(readyResult.body.activeTargets, 1);
    assert.deepEqual(readyResult.body.degradedReasons, ["dead_letter_jobs_present"]);
  } finally {
    await stopServer(server);
  }
});

test("api server readyz uses keyword query sessions as activeSessions when available", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetId = stableUuidFromString("reddit:target:r/datascience");

  await repos.monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/datascience",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });

  await repos.keywordQuerySessionRepository.createWithSamples(
    {
      id: "00000000-0000-0000-0000-000000000901",
      queryText: "LLM agent",
      normalizedQueryText: "llm agent",
      canonicalSubreddit: "r/datascience",
      status: "live_refreshing",
      coverageLevel: "medium",
      supportCount: 5,
      confidenceLevel: "medium",
      mentionRate: 0.1,
      qualifiedMentionRate: 0.04,
      sourceTypeSummary: {
        index: 4,
        live: 1,
        backfill: 0,
      },
      explainPayload: {},
      createdAt: "2026-04-10T11:50:00.000Z",
      updatedAt: "2026-04-10T11:59:00.000Z",
    },
    [],
  );

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const readyResult = await getJson<{
      queue: {
        running: number;
      };
      activeSessions: number;
    }>(`${baseUrl}/readyz`);

    assert.equal(readyResult.status, 200);
    assert.equal(readyResult.body.queue.running, 0);
    assert.equal(readyResult.body.activeSessions, 1);
  } finally {
    await stopServer(server);
  }
});

test("api server readyz reports provider degradation from health window evidence", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetId = stableUuidFromString("reddit:target:r/datascience");

  await repos.monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/datascience",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });

  await repos.providerHealthWindowRepository.record({
    provider: "http",
    targetId,
    mode: "live",
    windowStart: "2026-04-10T11:55:00.000Z",
    requestCountDelta: 10,
    successCountDelta: 4,
    emptyResponseCountDelta: 9,
    fallbackCountDelta: 8,
    candidateCountDelta: 40,
    acceptedCountDelta: 20,
    filteredOutCountDelta: 20,
    duplicatePostCountDelta: 5,
    ingestLagSecondsSumDelta: 7200,
    ingestLagSampleCountDelta: 4,
    providerDiffCountDelta: 1,
    providerDiffSampleCountDelta: 2,
    errorCountDelta: 6,
    rateLimitCountDelta: 4,
    timeoutCountDelta: 2,
    circuitOpenCountDelta: 0,
    updatedAt: fixedNow,
  });

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const readyResult = await getJson<{
      status: string;
      degradedReasons: string[];
      observability: {
        fetchSuccessRate: number | null;
        fallbackRate: number | null;
        emptyWindowRate: number | null;
        duplicatePostRate: number | null;
        ingestLagSeconds: number | null;
        providerDiffRate: number | null;
        errorRate: number | null;
        rateLimitRate: number | null;
        timeoutRate: number | null;
        circuitOpenRate: number | null;
        providerSwitchShare: number | null;
        byProvider: Array<{
          provider: string;
          fallbackRate: number | null;
          fetchSuccessRate: number | null;
          duplicatePostRate: number | null;
          ingestLagSeconds: number | null;
          providerDiffRate: number | null;
          errorRate: number | null;
          rateLimitRate: number | null;
          timeoutRate: number | null;
          circuitOpenRate: number | null;
          providerSwitchShare: number | null;
        }>;
      };
    }>(`${baseUrl}/readyz`);

    assert.equal(readyResult.status, 200);
    assert.equal(readyResult.body.status, "degraded");
    assert.equal(readyResult.body.observability.fetchSuccessRate, 0.4);
    assert.equal(readyResult.body.observability.fallbackRate, 0.8);
    assert.equal(readyResult.body.observability.emptyWindowRate, 0.9);
    assert.equal(readyResult.body.observability.duplicatePostRate, 0.125);
    assert.equal(readyResult.body.observability.ingestLagSeconds, 1800);
    assert.equal(readyResult.body.observability.providerDiffRate, 0.5);
    assert.equal(readyResult.body.observability.errorRate, 0.6);
    assert.equal(readyResult.body.observability.rateLimitRate, 0.4);
    assert.equal(readyResult.body.observability.timeoutRate, 0.2);
    assert.equal(readyResult.body.observability.circuitOpenRate, 0);
    assert.equal(readyResult.body.observability.providerSwitchShare, 0);
    assert.equal(readyResult.body.observability.byProvider[0]?.provider, "http");
    assert.equal(readyResult.body.observability.byProvider[0]?.fallbackRate, 0.8);
    assert.equal(readyResult.body.observability.byProvider[0]?.duplicatePostRate, 0.125);
    assert.equal(readyResult.body.observability.byProvider[0]?.errorRate, 0.6);
    assert.equal(readyResult.body.observability.byProvider[0]?.rateLimitRate, 0.4);
    assert.equal(readyResult.body.observability.byProvider[0]?.timeoutRate, 0.2);
    assert.equal(readyResult.body.observability.byProvider[0]?.circuitOpenRate, 0);
    assert.equal(readyResult.body.observability.byProvider[0]?.providerSwitchShare, 0);
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_fetch_success_low:http"),
      true,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_fallback_elevated:http"),
      true,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_empty_window_elevated:http"),
      true,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_diff_elevated:http"),
      true,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_error_rate_elevated:http"),
      true,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_rate_limit_elevated:http"),
      true,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_timeout_elevated:http"),
      true,
    );
  } finally {
    await stopServer(server);
  }
});


test("api server readyz isolates degraded reasons for each provider-health scenario", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const requestCount = 100;

  const scenarios: Array<{
    slug: string;
    expectedReasons: string[];
    seed: (repos: ReturnType<typeof createApiTestRepositories>, targetId: string) => Promise<void>;
  }> = [
    {
      slug: "success-low",
      expectedReasons: ["provider_fetch_success_low:http"],
      seed: async (repos, targetId) => {
        await repos.providerHealthWindowRepository.record({
          provider: "http",
          targetId,
          mode: "live",
          windowStart: "2026-04-10T11:55:00.000Z",
          requestCountDelta: requestCount,
          successCountDelta: 69,
          emptyResponseCountDelta: 0,
          fallbackCountDelta: 0,
          candidateCountDelta: requestCount,
          acceptedCountDelta: requestCount,
          filteredOutCountDelta: 0,
          duplicatePostCountDelta: 0,
          ingestLagSecondsSumDelta: 0,
          ingestLagSampleCountDelta: 0,
          providerDiffCountDelta: 0,
          providerDiffSampleCountDelta: 0,
          errorCountDelta: 0,
          rateLimitCountDelta: 0,
          timeoutCountDelta: 0,
          circuitOpenCountDelta: 0,
          updatedAt: fixedNow,
        });
      },
    },
    {
      slug: "fallback-high",
      expectedReasons: ["provider_fallback_elevated:http"],
      seed: async (repos, targetId) => {
        await repos.providerHealthWindowRepository.record({
          provider: "http",
          targetId,
          mode: "live",
          windowStart: "2026-04-10T11:55:00.000Z",
          requestCountDelta: requestCount,
          successCountDelta: requestCount,
          emptyResponseCountDelta: 0,
          fallbackCountDelta: 61,
          candidateCountDelta: requestCount,
          acceptedCountDelta: requestCount,
          filteredOutCountDelta: 0,
          duplicatePostCountDelta: 0,
          ingestLagSecondsSumDelta: 0,
          ingestLagSampleCountDelta: 0,
          providerDiffCountDelta: 0,
          providerDiffSampleCountDelta: 0,
          errorCountDelta: 0,
          rateLimitCountDelta: 0,
          timeoutCountDelta: 0,
          circuitOpenCountDelta: 0,
          updatedAt: fixedNow,
        });
      },
    },
    {
      slug: "empty-high",
      expectedReasons: ["provider_empty_window_elevated:http"],
      seed: async (repos, targetId) => {
        await repos.providerHealthWindowRepository.record({
          provider: "http",
          targetId,
          mode: "live",
          windowStart: "2026-04-10T11:55:00.000Z",
          requestCountDelta: requestCount,
          successCountDelta: requestCount,
          emptyResponseCountDelta: 86,
          fallbackCountDelta: 0,
          candidateCountDelta: requestCount,
          acceptedCountDelta: requestCount,
          filteredOutCountDelta: 0,
          duplicatePostCountDelta: 0,
          ingestLagSecondsSumDelta: 0,
          ingestLagSampleCountDelta: 0,
          providerDiffCountDelta: 0,
          providerDiffSampleCountDelta: 0,
          errorCountDelta: 0,
          rateLimitCountDelta: 0,
          timeoutCountDelta: 0,
          circuitOpenCountDelta: 0,
          updatedAt: fixedNow,
        });
      },
    },
    {
      slug: "diff-high",
      expectedReasons: ["provider_diff_elevated:http"],
      seed: async (repos, targetId) => {
        await repos.providerHealthWindowRepository.record({
          provider: "http",
          targetId,
          mode: "live",
          windowStart: "2026-04-10T11:55:00.000Z",
          requestCountDelta: requestCount,
          successCountDelta: requestCount,
          emptyResponseCountDelta: 0,
          fallbackCountDelta: 0,
          candidateCountDelta: requestCount,
          acceptedCountDelta: requestCount,
          filteredOutCountDelta: 0,
          duplicatePostCountDelta: 0,
          ingestLagSecondsSumDelta: 0,
          ingestLagSampleCountDelta: 0,
          providerDiffCountDelta: 4,
          providerDiffSampleCountDelta: 10,
          errorCountDelta: 0,
          rateLimitCountDelta: 0,
          timeoutCountDelta: 0,
          circuitOpenCountDelta: 0,
          updatedAt: fixedNow,
        });
      },
    },
    {
      slug: "rate-limit-high",
      expectedReasons: ["provider_rate_limit_elevated:http"],
      seed: async (repos, targetId) => {
        await repos.providerHealthWindowRepository.record({
          provider: "http",
          targetId,
          mode: "live",
          windowStart: "2026-04-10T11:55:00.000Z",
          requestCountDelta: requestCount,
          successCountDelta: 84,
          emptyResponseCountDelta: 0,
          fallbackCountDelta: 0,
          candidateCountDelta: requestCount,
          acceptedCountDelta: requestCount,
          filteredOutCountDelta: 0,
          duplicatePostCountDelta: 0,
          ingestLagSecondsSumDelta: 0,
          ingestLagSampleCountDelta: 0,
          providerDiffCountDelta: 0,
          providerDiffSampleCountDelta: 0,
          errorCountDelta: 16,
          rateLimitCountDelta: 16,
          timeoutCountDelta: 0,
          circuitOpenCountDelta: 0,
          updatedAt: fixedNow,
        });
      },
    },
    {
      slug: "timeout-high",
      expectedReasons: ["provider_timeout_elevated:http"],
      seed: async (repos, targetId) => {
        await repos.providerHealthWindowRepository.record({
          provider: "http",
          targetId,
          mode: "live",
          windowStart: "2026-04-10T11:55:00.000Z",
          requestCountDelta: requestCount,
          successCountDelta: 87,
          emptyResponseCountDelta: 0,
          fallbackCountDelta: 0,
          candidateCountDelta: requestCount,
          acceptedCountDelta: requestCount,
          filteredOutCountDelta: 0,
          duplicatePostCountDelta: 0,
          ingestLagSecondsSumDelta: 0,
          ingestLagSampleCountDelta: 0,
          providerDiffCountDelta: 0,
          providerDiffSampleCountDelta: 0,
          errorCountDelta: 13,
          rateLimitCountDelta: 0,
          timeoutCountDelta: 13,
          circuitOpenCountDelta: 0,
          updatedAt: fixedNow,
        });
      },
    },
    {
      slug: "circuit-open-high",
      expectedReasons: ["provider_circuit_open_elevated:http"],
      seed: async (repos, targetId) => {
        await repos.providerHealthWindowRepository.record({
          provider: "http",
          targetId,
          mode: "live",
          windowStart: "2026-04-10T11:55:00.000Z",
          requestCountDelta: requestCount,
          successCountDelta: 91,
          emptyResponseCountDelta: 0,
          fallbackCountDelta: 0,
          candidateCountDelta: requestCount,
          acceptedCountDelta: requestCount,
          filteredOutCountDelta: 0,
          duplicatePostCountDelta: 0,
          ingestLagSecondsSumDelta: 0,
          ingestLagSampleCountDelta: 0,
          providerDiffCountDelta: 0,
          providerDiffSampleCountDelta: 0,
          errorCountDelta: 9,
          rateLimitCountDelta: 0,
          timeoutCountDelta: 0,
          circuitOpenCountDelta: 9,
          updatedAt: fixedNow,
        });
      },
    },
    {
      slug: "provider-switch-high",
      expectedReasons: ["provider_switch_elevated:apify", "provider_switch_elevated:http"],
      seed: async (repos, targetId) => {
        await repos.providerHealthWindowRepository.record({
          provider: "http",
          targetId,
          mode: "live",
          windowStart: "2026-04-10T11:55:00.000Z",
          requestCountDelta: 79,
          successCountDelta: 79,
          emptyResponseCountDelta: 0,
          fallbackCountDelta: 0,
          candidateCountDelta: 79,
          acceptedCountDelta: 79,
          filteredOutCountDelta: 0,
          duplicatePostCountDelta: 0,
          ingestLagSecondsSumDelta: 0,
          ingestLagSampleCountDelta: 0,
          providerDiffCountDelta: 0,
          providerDiffSampleCountDelta: 0,
          errorCountDelta: 0,
          rateLimitCountDelta: 0,
          timeoutCountDelta: 0,
          circuitOpenCountDelta: 0,
          updatedAt: fixedNow,
        });
        await repos.providerHealthWindowRepository.record({
          provider: "apify",
          targetId,
          mode: "live",
          windowStart: "2026-04-10T11:55:00.000Z",
          requestCountDelta: 21,
          successCountDelta: 21,
          emptyResponseCountDelta: 0,
          fallbackCountDelta: 0,
          candidateCountDelta: 21,
          acceptedCountDelta: 21,
          filteredOutCountDelta: 0,
          duplicatePostCountDelta: 0,
          ingestLagSecondsSumDelta: 0,
          ingestLagSampleCountDelta: 0,
          providerDiffCountDelta: 0,
          providerDiffSampleCountDelta: 0,
          errorCountDelta: 0,
          rateLimitCountDelta: 0,
          timeoutCountDelta: 0,
          circuitOpenCountDelta: 0,
          updatedAt: fixedNow,
        });
      },
    },
  ];

  for (const scenario of scenarios) {
    const repos = createApiTestRepositories();
    const targetId = stableUuidFromString(`reddit:target:r/${scenario.slug}`);

    await repos.monitorTargetRepository.upsert({
      id: targetId,
      source: "reddit",
      targetType: "subreddit",
      canonicalName: `r/${scenario.slug}`,
      status: "active",
      config: {},
      createdAt: fixedNow,
      updatedAt: fixedNow,
    });
    await scenario.seed(repos, targetId);

    const server = createApiServer({
      repositories: repos,
      createConnector: () => new RedditMockConnector(),
      now: () => fixedNow,
    });

    const baseUrl = await startServer(server);
    try {
      const readyResult = await getJson<{
        status: string;
        degradedReasons: string[];
      }>(`${baseUrl}/readyz`);

      assert.equal(readyResult.status, 200, scenario.slug);
      assert.equal(readyResult.body.status, "degraded", scenario.slug);
      assert.deepEqual(
        [...readyResult.body.degradedReasons].sort(),
        [...scenario.expectedReasons].sort(),
        scenario.slug,
      );
    } finally {
      await stopServer(server);
    }
  }
});
test("api server readyz exposes provider switch evidence across providers", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetId = stableUuidFromString("reddit:target:r/switching");

  await repos.providerHealthWindowRepository.record({
    provider: "http",
    targetId,
    mode: "live",
    windowStart: "2026-04-10T11:55:00.000Z",
    requestCountDelta: 7,
    successCountDelta: 7,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 21,
    acceptedCountDelta: 21,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 0,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    updatedAt: fixedNow,
  });
  await repos.providerHealthWindowRepository.record({
    provider: "apify",
    targetId,
    mode: "live",
    windowStart: "2026-04-10T11:55:00.000Z",
    requestCountDelta: 3,
    successCountDelta: 3,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 9,
    acceptedCountDelta: 9,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 0,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    updatedAt: fixedNow,
  });

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const readyResult = await getJson<{
      observability: {
        providerSwitchShare: number | null;
        byProvider: Array<{
          provider: string;
          providerSwitchShare: number | null;
        }>;
      };
      degradedReasons: string[];
    }>(`${baseUrl}/readyz`);

    assert.equal(readyResult.status, 200);
    assert.equal(readyResult.body.observability.providerSwitchShare, 0.3);
    assert.equal(readyResult.body.observability.byProvider[0]?.provider, "apify");
    assert.equal(readyResult.body.observability.byProvider[0]?.providerSwitchShare, 0.7);
    assert.equal(readyResult.body.observability.byProvider[1]?.provider, "http");
    assert.equal(readyResult.body.observability.byProvider[1]?.providerSwitchShare, 0.3);
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_switch_elevated:apify"),
      true,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_switch_elevated:http"),
      true,
    );
  } finally {
    await stopServer(server);
  }
});

test("api server readyz marks stale live crawl cursors as degraded", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetId = stableUuidFromString("reddit:target:r/stalled");

  await repos.monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/stalled",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  await repos.crawlCursorRepository.upsert({
    provider: "http",
    targetId,
    mode: "live",
    cursor: "t3_stalled_cursor",
    lastFetchedAt: "2026-04-10T11:40:00.000Z",
    updatedAt: "2026-04-10T11:40:00.000Z",
  });

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const readyResult = await getJson<{
      status: string;
      observability: {
        cursorStallRate: number | null;
        cursorLagSecondsMax: number | null;
        byProvider: Array<{
          provider: string;
          cursorStallRate: number | null;
          cursorLagSecondsMax: number | null;
        }>;
      };
      degradedReasons: string[];
    }>(`${baseUrl}/readyz`);

    assert.equal(readyResult.status, 200);
    assert.equal(readyResult.body.status, "degraded");
    assert.equal(readyResult.body.observability.cursorStallRate, 1);
    assert.equal(readyResult.body.observability.cursorLagSecondsMax, 1200);
    assert.equal(readyResult.body.observability.byProvider[0]?.provider, "http");
    assert.equal(readyResult.body.observability.byProvider[0]?.cursorStallRate, 1);
    assert.equal(readyResult.body.observability.byProvider[0]?.cursorLagSecondsMax, 1200);
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_cursor_stalled:http"),
      true,
    );
  } finally {
    await stopServer(server);
  }
});

test("api server readyz keeps fresh live crawl cursors below stall threshold", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetId = stableUuidFromString("reddit:target:r/fresh");

  await repos.monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/fresh",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  await repos.crawlCursorRepository.upsert({
    provider: "http",
    targetId,
    mode: "live",
    cursor: "t3_fresh_cursor",
    lastFetchedAt: "2026-04-10T11:55:00.000Z",
    updatedAt: "2026-04-10T11:55:00.000Z",
  });

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const readyResult = await getJson<{
      status: string;
      observability: {
        cursorStallRate: number | null;
        cursorLagSecondsMax: number | null;
      };
      degradedReasons: string[];
    }>(`${baseUrl}/readyz`);

    assert.equal(readyResult.status, 200);
    assert.equal(readyResult.body.status, "ready");
    assert.equal(readyResult.body.observability.cursorStallRate, 0);
    assert.equal(readyResult.body.observability.cursorLagSecondsMax, 300);
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_cursor_stalled:http"),
      false,
    );
  } finally {
    await stopServer(server);
  }
});

test("api server readyz keeps cursor exactly at stall threshold as fresh", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetId = stableUuidFromString("reddit:target:r/cursor-threshold");
  const thresholdSeconds = READYZ_THRESHOLDS.cursorStallThresholdSeconds;
  const thresholdFetchedAt = new Date(
    new Date(fixedNow).getTime() - thresholdSeconds * 1000,
  ).toISOString();

  await repos.monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/cursor-threshold",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  await repos.providerHealthWindowRepository.record({
    provider: "http",
    targetId,
    mode: "live",
    windowStart: "2026-04-10T11:55:00.000Z",
    requestCountDelta: 1,
    successCountDelta: 1,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 10,
    acceptedCountDelta: 10,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 60,
    ingestLagSampleCountDelta: 1,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    updatedAt: fixedNow,
  });
  await repos.crawlCursorRepository.upsert({
    provider: "http",
    targetId,
    mode: "live",
    cursor: "t3_cursor_threshold",
    lastFetchedAt: thresholdFetchedAt,
    updatedAt: thresholdFetchedAt,
  });

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const readyResult = await getJson<{
      degradedReasons: string[];
      observability: {
        cursorStallRate: number | null;
        byProvider: Array<{
          provider: string;
          cursorStallRate: number | null;
          cursorLagSecondsMax: number | null;
        }>;
      };
    }>(`${baseUrl}/readyz`);

    assert.equal(readyResult.status, 200);
    assert.equal(readyResult.body.observability.cursorStallRate, 0);
    assert.equal(readyResult.body.observability.byProvider[0]?.provider, "http");
    assert.equal(readyResult.body.observability.byProvider[0]?.cursorStallRate, 0);
    assert.equal(
      readyResult.body.observability.byProvider[0]?.cursorLagSecondsMax,
      thresholdSeconds,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_cursor_stalled:http"),
      false,
    );
  } finally {
    await stopServer(server);
  }
});

test("api server readyz keeps duplicatePostRate for all-duplicate provider windows", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();

  await repos.providerHealthWindowRepository.record({
    provider: "http",
    targetId: stableUuidFromString("reddit:target:r/duplicates"),
    mode: "live",
    windowStart: "2026-04-10T11:55:00.000Z",
    requestCountDelta: 1,
    successCountDelta: 1,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 5,
    acceptedCountDelta: 0,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 5,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 0,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    updatedAt: fixedNow,
  });

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const readyResult = await getJson<{
      degradedReasons: string[];
      observability: {
        duplicatePostRate: number | null;
        byProvider: Array<{
          duplicatePostRate: number | null;
        }>;
      };
    }>(`${baseUrl}/readyz`);
    assert.equal(readyResult.status, 200);
    assert.equal(readyResult.body.observability.duplicatePostRate, 1);
    assert.equal(readyResult.body.observability.byProvider[0]?.duplicatePostRate, 1);
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_stale_head_elevated:http"),
      false,
    );
  } finally {
    await stopServer(server);
  }
});

test("api server readyz flags duplicate-heavy stale-head provider windows", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();

  await repos.providerHealthWindowRepository.record({
    provider: "http",
    targetId: stableUuidFromString("reddit:target:r/stale-head"),
    mode: "live",
    windowStart: "2026-04-10T11:55:00.000Z",
    requestCountDelta: 3,
    successCountDelta: 3,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 40,
    acceptedCountDelta: 40,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 26,
    ingestLagSecondsSumDelta: 630000,
    ingestLagSampleCountDelta: 3,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    updatedAt: fixedNow,
  });

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const readyResult = await getJson<{
      status: string;
      degradedReasons: string[];
      observability: {
        duplicatePostRate: number | null;
        ingestLagSeconds: number | null;
        byProvider: Array<{
          provider: string;
          duplicatePostRate: number | null;
          ingestLagSeconds: number | null;
        }>;
      };
    }>(`${baseUrl}/readyz`);

    assert.equal(readyResult.status, 200);
    assert.equal(readyResult.body.status, "degraded");
    assert.equal(readyResult.body.observability.duplicatePostRate, 0.65);
    assert.equal(readyResult.body.observability.ingestLagSeconds, 210000);
    assert.equal(readyResult.body.observability.byProvider[0]?.provider, "http");
    assert.equal(readyResult.body.observability.byProvider[0]?.duplicatePostRate, 0.65);
    assert.equal(readyResult.body.observability.byProvider[0]?.ingestLagSeconds, 210000);
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_stale_head_elevated:http"),
      true,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_data_stalled:http"),
      false,
    );
  } finally {
    await stopServer(server);
  }
});

test("api server readyz treats exact stale-head thresholds as degraded", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetId = stableUuidFromString("reddit:target:r/stale-threshold");

  await repos.monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/stale-threshold",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  await repos.providerHealthWindowRepository.record({
    provider: "http",
    targetId,
    mode: "live",
    windowStart: "2026-04-10T11:55:00.000Z",
    requestCountDelta: 2,
    successCountDelta: 2,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 20,
    acceptedCountDelta: 20,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: READYZ_THRESHOLDS.staleHeadDuplicatePostRateMin * 20,
    ingestLagSecondsSumDelta: READYZ_THRESHOLDS.staleHeadIngestLagSecondsMin * 2,
    ingestLagSampleCountDelta: 2,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    updatedAt: fixedNow,
  });

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const readyResult = await getJson<{
      degradedReasons: string[];
      observability: {
        byProvider: Array<{
          provider: string;
          duplicatePostRate: number | null;
          ingestLagSeconds: number | null;
        }>;
      };
    }>(`${baseUrl}/readyz`);

    assert.equal(readyResult.status, 200);
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_stale_head_elevated:http"),
      true,
    );
    assert.equal(readyResult.body.observability.byProvider[0]?.provider, "http");
    assert.equal(
      readyResult.body.observability.byProvider[0]?.duplicatePostRate,
      READYZ_THRESHOLDS.staleHeadDuplicatePostRateMin,
    );
    assert.equal(
      readyResult.body.observability.byProvider[0]?.ingestLagSeconds,
      READYZ_THRESHOLDS.staleHeadIngestLagSecondsMin,
    );
  } finally {
    await stopServer(server);
  }
});

test("api server readyz keeps exact circuit-open threshold below degraded", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetId = stableUuidFromString("reddit:target:r/circuit-threshold");
  const requestCount = 25;
  const circuitOpenCount =
    READYZ_THRESHOLDS.providerHealthCircuitOpenRateMax * requestCount;

  await repos.monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/circuit-threshold",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  await repos.providerHealthWindowRepository.record({
    provider: "http",
    targetId,
    mode: "live",
    windowStart: "2026-04-10T11:55:00.000Z",
    requestCountDelta: requestCount,
    successCountDelta: requestCount - circuitOpenCount,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: requestCount,
    acceptedCountDelta: requestCount,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 0,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: circuitOpenCount,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: circuitOpenCount,
    updatedAt: fixedNow,
  });

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const readyResult = await getJson<{
      status: string;
      degradedReasons: string[];
      observability: {
        byProvider: Array<{
          provider: string;
          circuitOpenRate: number | null;
        }>;
      };
    }>(`${baseUrl}/readyz`);

    assert.equal(readyResult.status, 200);
    assert.equal(readyResult.body.status, "ready");
    assert.equal(readyResult.body.observability.byProvider[0]?.provider, "http");
    assert.equal(
      readyResult.body.observability.byProvider[0]?.circuitOpenRate,
      READYZ_THRESHOLDS.providerHealthCircuitOpenRateMax,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_circuit_open_elevated:http"),
      false,
    );
  } finally {
    await stopServer(server);
  }
});


test("api server readyz keeps exact strict-greater provider-health thresholds below degraded", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetId = stableUuidFromString("reddit:target:r/strict-greater-thresholds");
  const requestCount = 100;
  const diffSampleCount = 10;

  await repos.monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/strict-greater-thresholds",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  await repos.providerHealthWindowRepository.record({
    provider: "http",
    targetId,
    mode: "live",
    windowStart: "2026-04-10T11:55:00.000Z",
    requestCountDelta: requestCount,
    successCountDelta: READYZ_THRESHOLDS.providerHealthSuccessRateMin * requestCount,
    emptyResponseCountDelta: READYZ_THRESHOLDS.providerHealthEmptyRateMax * requestCount,
    fallbackCountDelta: READYZ_THRESHOLDS.providerHealthFallbackRateMax * requestCount,
    candidateCountDelta: requestCount,
    acceptedCountDelta: requestCount,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 0,
    providerDiffCountDelta: READYZ_THRESHOLDS.providerHealthDiffRateMax * diffSampleCount,
    providerDiffSampleCountDelta: diffSampleCount,
    errorCountDelta: READYZ_THRESHOLDS.providerHealthErrorRateMax * requestCount,
    rateLimitCountDelta: READYZ_THRESHOLDS.providerHealthRateLimitRateMax * requestCount,
    timeoutCountDelta: READYZ_THRESHOLDS.providerHealthTimeoutRateMax * requestCount,
    circuitOpenCountDelta: READYZ_THRESHOLDS.providerHealthCircuitOpenRateMax * requestCount,
    updatedAt: fixedNow,
  });

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const readyResult = await getJson<{
      status: string;
      degradedReasons: string[];
      observability: {
        byProvider: Array<{
          provider: string;
          fetchSuccessRate: number | null;
          fallbackRate: number | null;
          emptyWindowRate: number | null;
          providerDiffRate: number | null;
          errorRate: number | null;
          rateLimitRate: number | null;
          timeoutRate: number | null;
          circuitOpenRate: number | null;
        }>;
      };
    }>(`${baseUrl}/readyz`);

    assert.equal(readyResult.status, 200);
    assert.equal(readyResult.body.status, "ready");
    assert.equal(readyResult.body.observability.byProvider[0]?.provider, "http");
    assert.equal(
      readyResult.body.observability.byProvider[0]?.fetchSuccessRate,
      READYZ_THRESHOLDS.providerHealthSuccessRateMin,
    );
    assert.equal(
      readyResult.body.observability.byProvider[0]?.fallbackRate,
      READYZ_THRESHOLDS.providerHealthFallbackRateMax,
    );
    assert.equal(
      readyResult.body.observability.byProvider[0]?.emptyWindowRate,
      READYZ_THRESHOLDS.providerHealthEmptyRateMax,
    );
    assert.equal(
      readyResult.body.observability.byProvider[0]?.providerDiffRate,
      READYZ_THRESHOLDS.providerHealthDiffRateMax,
    );
    assert.equal(
      readyResult.body.observability.byProvider[0]?.errorRate,
      READYZ_THRESHOLDS.providerHealthErrorRateMax,
    );
    assert.equal(
      readyResult.body.observability.byProvider[0]?.rateLimitRate,
      READYZ_THRESHOLDS.providerHealthRateLimitRateMax,
    );
    assert.equal(
      readyResult.body.observability.byProvider[0]?.timeoutRate,
      READYZ_THRESHOLDS.providerHealthTimeoutRateMax,
    );
    assert.equal(
      readyResult.body.observability.byProvider[0]?.circuitOpenRate,
      READYZ_THRESHOLDS.providerHealthCircuitOpenRateMax,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_fetch_success_low:http"),
      false,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_fallback_elevated:http"),
      false,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_empty_window_elevated:http"),
      false,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_diff_elevated:http"),
      false,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_error_rate_elevated:http"),
      false,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_rate_limit_elevated:http"),
      false,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_timeout_elevated:http"),
      false,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_circuit_open_elevated:http"),
      false,
    );
  } finally {
    await stopServer(server);
  }
});

test("api server readyz keeps dominant provider-switch share at exact threshold below degraded", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const requestCount = 10;
  const dominantProviderRequestCount =
    requestCount - READYZ_THRESHOLDS.providerHealthSwitchShareMax * requestCount;

  await repos.providerHealthWindowRepository.record({
    provider: "http",
    targetId: stableUuidFromString("reddit:target:r/provider-switch-http"),
    mode: "live",
    windowStart: "2026-04-10T11:55:00.000Z",
    requestCountDelta: dominantProviderRequestCount,
    successCountDelta: dominantProviderRequestCount,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: dominantProviderRequestCount,
    acceptedCountDelta: dominantProviderRequestCount,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 0,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    updatedAt: fixedNow,
  });
  await repos.providerHealthWindowRepository.record({
    provider: "apify",
    targetId: stableUuidFromString("reddit:target:r/provider-switch-apify"),
    mode: "live",
    windowStart: "2026-04-10T11:55:00.000Z",
    requestCountDelta: requestCount - dominantProviderRequestCount,
    successCountDelta: requestCount - dominantProviderRequestCount,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: requestCount - dominantProviderRequestCount,
    acceptedCountDelta: requestCount - dominantProviderRequestCount,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 0,
    ingestLagSecondsSumDelta: 0,
    ingestLagSampleCountDelta: 0,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    updatedAt: fixedNow,
  });

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const readyResult = await getJson<{
      degradedReasons: string[];
      observability: {
        byProvider: Array<{
          provider: string;
          providerSwitchShare: number | null;
        }>;
      };
    }>(`${baseUrl}/readyz`);

    assert.equal(readyResult.status, 200);
    const httpProvider = readyResult.body.observability.byProvider.find(
      (provider) => provider.provider === "http",
    );
    assert.equal(
      httpProvider?.providerSwitchShare,
      READYZ_THRESHOLDS.providerHealthSwitchShareMax,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_switch_elevated:http"),
      false,
    );
  } finally {
    await stopServer(server);
  }
});
test("api server readyz flags combined stale-head and cursor-stall evidence per provider", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetId = stableUuidFromString("reddit:target:r/data-stalled");

  await repos.monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/data-stalled",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  await repos.providerHealthWindowRepository.record({
    provider: "http",
    targetId,
    mode: "live",
    windowStart: "2026-04-10T11:55:00.000Z",
    requestCountDelta: 3,
    successCountDelta: 3,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 40,
    acceptedCountDelta: 40,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 26,
    ingestLagSecondsSumDelta: 630000,
    ingestLagSampleCountDelta: 3,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    updatedAt: fixedNow,
  });
  await repos.crawlCursorRepository.upsert({
    provider: "http",
    targetId,
    mode: "live",
    cursor: "t3_data_stalled_cursor",
    lastFetchedAt: "2026-04-10T11:40:00.000Z",
    updatedAt: "2026-04-10T11:40:00.000Z",
  });

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const readyResult = await getJson<{
      status: string;
      degradedReasons: string[];
      observability: {
        byProvider: Array<{
          provider: string;
          duplicatePostRate: number | null;
          ingestLagSeconds: number | null;
          cursorStallRate: number | null;
          cursorLagSecondsMax: number | null;
        }>;
      };
    }>(`${baseUrl}/readyz`);

    assert.equal(readyResult.status, 200);
    assert.equal(readyResult.body.status, "degraded");
    assert.equal(readyResult.body.observability.byProvider[0]?.provider, "http");
    assert.equal(readyResult.body.observability.byProvider[0]?.duplicatePostRate, 0.65);
    assert.equal(readyResult.body.observability.byProvider[0]?.ingestLagSeconds, 210000);
    assert.equal(readyResult.body.observability.byProvider[0]?.cursorStallRate, 1);
    assert.equal(readyResult.body.observability.byProvider[0]?.cursorLagSecondsMax, 1200);
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_stale_head_elevated:http"),
      true,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_cursor_stalled:http"),
      true,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_data_stalled:http"),
      true,
    );
  } finally {
    await stopServer(server);
  }
});

test("api server readyz ignores stale legacy cursor providers outside current live health window", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const activeTargetId = stableUuidFromString("reddit:target:r/http-active");
  const legacyTargetId = stableUuidFromString("reddit:target:r/legacy-provider");

  await repos.monitorTargetRepository.upsert({
    id: activeTargetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/http-active",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  await repos.monitorTargetRepository.upsert({
    id: legacyTargetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/legacy-provider",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  await repos.providerHealthWindowRepository.record({
    provider: "http",
    targetId: activeTargetId,
    mode: "live",
    windowStart: "2026-04-10T11:55:00.000Z",
    requestCountDelta: 3,
    successCountDelta: 3,
    emptyResponseCountDelta: 0,
    fallbackCountDelta: 0,
    candidateCountDelta: 40,
    acceptedCountDelta: 40,
    filteredOutCountDelta: 0,
    duplicatePostCountDelta: 26,
    ingestLagSecondsSumDelta: 630000,
    ingestLagSampleCountDelta: 3,
    providerDiffCountDelta: 0,
    providerDiffSampleCountDelta: 0,
    errorCountDelta: 0,
    rateLimitCountDelta: 0,
    timeoutCountDelta: 0,
    circuitOpenCountDelta: 0,
    updatedAt: fixedNow,
  });
  await repos.crawlCursorRepository.upsert({
    provider: "http",
    targetId: activeTargetId,
    mode: "live",
    cursor: "t3_http_active_cursor",
    lastFetchedAt: "2026-04-10T11:59:30.000Z",
    updatedAt: "2026-04-10T11:59:30.000Z",
  });
  await repos.crawlCursorRepository.upsert({
    provider: "reddit",
    targetId: legacyTargetId,
    mode: "live",
    cursor: "t3_legacy_reddit_cursor",
    lastFetchedAt: "2026-04-10T11:40:00.000Z",
    updatedAt: "2026-04-10T11:40:00.000Z",
  });

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const readyResult = await getJson<{
      status: string;
      degradedReasons: string[];
      observability: {
        cursorStallRate: number | null;
        byProvider: Array<{
          provider: string;
          cursorStallRate: number | null;
          cursorLagSecondsMax: number | null;
        }>;
      };
    }>(`${baseUrl}/readyz`);

    assert.equal(readyResult.status, 200);
    assert.equal(readyResult.body.status, "degraded");
    assert.equal(readyResult.body.observability.cursorStallRate, 0);
    assert.equal(readyResult.body.observability.byProvider.length, 1);
    assert.equal(readyResult.body.observability.byProvider[0]?.provider, "http");
    assert.equal(readyResult.body.observability.byProvider[0]?.cursorStallRate, 0);
    assert.equal(readyResult.body.observability.byProvider[0]?.cursorLagSecondsMax, 30);
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_stale_head_elevated:http"),
      true,
    );
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_cursor_stalled:reddit"),
      false,
    );
  } finally {
    await stopServer(server);
  }
});

test("api server readyz reports unavailable observability signals with bounded status transitions", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";

  const scenarios: Array<{
    slug: string;
    patch: (repos: ReturnType<typeof createApiTestRepositories>) => void;
    expectedHttpStatus: 200 | 503;
    expectedStatus: "ready" | "degraded" | "not_ready";
    expectedStorageCheck: "ok" | "error";
    expectedQueueCheck: "ok" | "degraded" | "error";
    expectedReason: string;
  }> = [
    {
      slug: "storage-unavailable",
      patch: (repos) => {
        repos.monitorTargetRepository.findActiveSubreddits = async () => {
          throw new Error("simulated storage failure");
        };
      },
      expectedHttpStatus: 503,
      expectedStatus: "not_ready",
      expectedStorageCheck: "error",
      expectedQueueCheck: "ok",
      expectedReason: "storage_unavailable",
    },
    {
      slug: "queue-unavailable",
      patch: (repos) => {
        repos.collectionJobRepository.getOperationalSummary = async () => {
          throw new Error("simulated queue failure");
        };
      },
      expectedHttpStatus: 503,
      expectedStatus: "not_ready",
      expectedStorageCheck: "ok",
      expectedQueueCheck: "error",
      expectedReason: "queue_unavailable",
    },
    {
      slug: "keyword-session-observability-unavailable",
      patch: (repos) => {
        repos.keywordQuerySessionRepository.countActiveSessions = async () => {
          throw new Error("simulated keyword session failure");
        };
      },
      expectedHttpStatus: 200,
      expectedStatus: "degraded",
      expectedStorageCheck: "ok",
      expectedQueueCheck: "ok",
      expectedReason: "keyword_session_observability_unavailable",
    },
    {
      slug: "provider-health-unavailable",
      patch: (repos) => {
        repos.providerHealthWindowRepository.summarizeByProviderInRange = async () => {
          throw new Error("simulated provider health failure");
        };
      },
      expectedHttpStatus: 200,
      expectedStatus: "degraded",
      expectedStorageCheck: "ok",
      expectedQueueCheck: "ok",
      expectedReason: "provider_health_unavailable",
    },
    {
      slug: "crawl-cursor-observability-unavailable",
      patch: (repos) => {
        repos.crawlCursorRepository.list = async () => {
          throw new Error("simulated crawl cursor failure");
        };
      },
      expectedHttpStatus: 200,
      expectedStatus: "degraded",
      expectedStorageCheck: "ok",
      expectedQueueCheck: "ok",
      expectedReason: "crawl_cursor_observability_unavailable",
    },
  ];

  for (const scenario of scenarios) {
    const repos = createApiTestRepositories();
    scenario.patch(repos);

    const server = createApiServer({
      repositories: repos,
      createConnector: () => new RedditMockConnector(),
      now: () => fixedNow,
    });

    const baseUrl = await startServer(server);
    try {
      const readyResult = await getJson<{
        status: "ready" | "degraded" | "not_ready";
        checks: {
          storage: "ok" | "error";
          queue: "ok" | "degraded" | "error";
        };
        degradedReasons: string[];
      }>(`${baseUrl}/readyz`);

      assert.equal(readyResult.status, scenario.expectedHttpStatus, scenario.slug);
      assert.equal(readyResult.body.status, scenario.expectedStatus, scenario.slug);
      assert.equal(
        readyResult.body.checks.storage,
        scenario.expectedStorageCheck,
        `${scenario.slug}:storage`,
      );
      assert.equal(
        readyResult.body.checks.queue,
        scenario.expectedQueueCheck,
        `${scenario.slug}:queue`,
      );
      assert.deepEqual(
        readyResult.body.degradedReasons,
        [scenario.expectedReason],
        `${scenario.slug}:reasons`,
      );
    } finally {
      await stopServer(server);
    }
  }
});

test("api server readyz keeps cursor-stall evidence when provider health observability is unavailable", async () => {
  const fixedNow = "2026-04-10T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetId = stableUuidFromString("reddit:target:r/provider-health-unavailable-cursor");

  await repos.monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/provider-health-unavailable-cursor",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  await repos.crawlCursorRepository.upsert({
    provider: "reddit",
    targetId,
    mode: "live",
    cursor: "t3_provider_health_unavailable_cursor",
    lastFetchedAt: "2026-04-10T11:40:00.000Z",
    updatedAt: "2026-04-10T11:40:00.000Z",
  });
  repos.providerHealthWindowRepository.summarizeByProviderInRange = async () => {
    throw new Error("simulated provider health failure");
  };

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const readyResult = await getJson<{
      status: "ready" | "degraded" | "not_ready";
      degradedReasons: string[];
      observability: {
        cursorStallRate: number | null;
        byProvider: Array<{
          provider: string;
          cursorStallRate: number | null;
          cursorLagSecondsMax: number | null;
        }>;
      };
    }>(`${baseUrl}/readyz`);

    assert.equal(readyResult.status, 200);
    assert.equal(readyResult.body.status, "degraded");
    assert.deepEqual(readyResult.body.degradedReasons, [
      "provider_health_unavailable",
      "provider_cursor_stalled:reddit",
    ]);
    assert.equal(readyResult.body.observability.cursorStallRate, 1);
    assert.equal(readyResult.body.observability.byProvider.length, 1);
    assert.equal(readyResult.body.observability.byProvider[0]?.provider, "reddit");
    assert.equal(readyResult.body.observability.byProvider[0]?.cursorStallRate, 1);
    assert.equal(readyResult.body.observability.byProvider[0]?.cursorLagSecondsMax, 1200);
    assert.equal(
      readyResult.body.degradedReasons.includes("provider_data_stalled:reddit"),
      false,
    );
  } finally {
    await stopServer(server);
  }
});

test("api server readyz reports stale algorithm materialization when recent snapshots have no daily facts", async () => {
  const fixedNow = "2026-04-12T12:00:00.000Z";
  const repos = createApiTestRepositories();
  const targetId = stableUuidFromString("reddit:target:r/datascience");

  await repos.monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: "r/datascience",
    status: "active",
    config: {},
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  await repos.metricsSnapshotRepository.appendMany([
    {
      snapshotAt: "2026-04-12T11:45:00.000Z",
      source: "reddit",
      targetId,
      granularity: "15m",
      metricName: "new_posts_15m",
      metricValue: 3,
      collectionJobId: stableUuidFromString("job:recent:snapshot"),
    },
  ]);

  const server = createApiServer({
    repositories: repos,
    createConnector: () => new RedditMockConnector(),
    now: () => fixedNow,
  });

  const baseUrl = await startServer(server);
  try {
    const readyResult = await getJson<{
      status: "ready" | "degraded" | "not_ready";
      degradedReasons: string[];
      observability: {
        dailyFactCoverageRate: number | null;
        dailyFactLagDaysMax: number | null;
      };
    }>(`${baseUrl}/readyz`);

    assert.equal(readyResult.status, 200);
    assert.equal(readyResult.body.status, "degraded");
    assert.equal(
      readyResult.body.degradedReasons.includes("algorithm_daily_fact_stale"),
      true,
    );
    assert.equal(readyResult.body.observability.dailyFactCoverageRate, 0);
    assert.equal(readyResult.body.observability.dailyFactLagDaysMax, 1);
  } finally {
    await stopServer(server);
  }
});

