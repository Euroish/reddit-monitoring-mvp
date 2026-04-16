import test from "node:test";
import assert from "node:assert/strict";
import { DefaultRedditMapper } from "../../src/connectors/reddit/reddit.mapper";
import { RedditMockConnector } from "../../src/connectors/reddit/reddit-mock.connector";
import type { ConnectorRequestContext } from "../../src/connectors/shared/connector.interface";
import type { RedditCollectSubredditPostsArgs } from "../../src/connectors/reddit/reddit.types";
import type { SubredditTrendPoint } from "../../src/domain/entities/subreddit-trend-point";
import { stableUuidFromString } from "../../src/shared/ids/stable-id";
import {
  InMemoryAccountRepository,
  InMemoryCollectionJobRepository,
  InMemoryContentRepository,
  InMemoryMetricsSnapshotRepository,
  InMemoryMonitorTargetRepository,
  InMemoryProviderHealthWindowRepository,
  InMemoryRawEventRepository,
  InMemorySubredditDailyFactRepository,
  InMemorySubredditTrendPointRepository,
} from "../../src/storage/repositories/in-memory/in-memory.repositories";
import { PHASE1_SAMPLING_THRESHOLDS } from "../../src/workers/reddit-phase1-thresholds";
import { runRedditPhase1Cycle } from "../../src/workers/reddit-phase1.worker";

const nowIso = "2026-04-10T12:00:00.000Z";
const subreddit = "machinelearning";
const targetId = stableUuidFromString(`reddit:target:r/${subreddit}`);

class CaptureLimitConnector extends RedditMockConnector {
  public readonly requestedLimits: number[] = [];

  public override async collectSubredditPosts(
    args: RedditCollectSubredditPostsArgs,
    ctx: ConnectorRequestContext,
  ) {
    this.requestedLimits.push(args.limit);
    return super.collectSubredditPosts(args, ctx);
  }
}

function trendPoint(args: {
  windowStart: string;
  windowEnd: string;
  surgeScore: number;
  heatChangePct: number;
  dispersionScore: number;
  highScorePostCount: number;
  sampledPostCount: number;
  impactMomentum: number;
}): SubredditTrendPoint {
  return {
    targetId,
    windowStart: args.windowStart,
    windowEnd: args.windowEnd,
    newPosts: 10,
    highScorePostCount: args.highScorePostCount,
    sampledPostCount: args.sampledPostCount,
    heatChangePct: args.heatChangePct,
    surgeScore: args.surgeScore,
    dispersionScore: args.dispersionScore,
    deltaNewPostsVsPrevWindow: 0,
    deltaActiveUsersVsPrevWindow: 0,
    trendScore: 0.1,
    scoreComponents: {
      impactMomentum: args.impactMomentum,
    },
  };
}

async function runCycleWithRecentPoints(args: {
  points: SubredditTrendPoint[];
  boostCooldownWindows: number;
  providerHint?: string;
  providerHealthRows?: Array<{
    provider: string;
    requestCount: number;
    successCount: number;
    emptyResponseCount: number;
    fallbackCount: number;
    candidateCount: number;
    acceptedCount: number;
    filteredOutCount: number;
    duplicatePostCount: number;
    ingestLagSecondsSum: number;
    ingestLagSampleCount: number;
    providerDiffCount: number;
    providerDiffSampleCount: number;
    errorCount?: number;
    rateLimitCount?: number;
    timeoutCount?: number;
    circuitOpenCount?: number;
  }>;
}): Promise<number> {
  const monitorTargetRepository = new InMemoryMonitorTargetRepository();
  const collectionJobRepository = new InMemoryCollectionJobRepository();
  const rawEventRepository = new InMemoryRawEventRepository();
  const accountRepository = new InMemoryAccountRepository();
  const contentRepository = new InMemoryContentRepository();
  const metricsSnapshotRepository = new InMemoryMetricsSnapshotRepository();
  const subredditDailyFactRepository = new InMemorySubredditDailyFactRepository();
  const subredditTrendPointRepository = new InMemorySubredditTrendPointRepository();
  const providerHealthWindowRepository = new InMemoryProviderHealthWindowRepository();
  const connector = new CaptureLimitConnector();

  await monitorTargetRepository.upsert({
    id: targetId,
    source: "reddit",
    targetType: "subreddit",
    canonicalName: `r/${subreddit}`,
    status: "active",
    config: {},
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  await subredditTrendPointRepository.upsertMany(args.points);
  for (const row of args.providerHealthRows ?? []) {
    await providerHealthWindowRepository.record({
      provider: row.provider,
      targetId,
      mode: "live",
      windowStart: "2026-04-10T11:55:00.000Z",
      requestCountDelta: row.requestCount,
      successCountDelta: row.successCount,
      emptyResponseCountDelta: row.emptyResponseCount,
      fallbackCountDelta: row.fallbackCount,
      candidateCountDelta: row.candidateCount,
      acceptedCountDelta: row.acceptedCount,
      filteredOutCountDelta: row.filteredOutCount,
      duplicatePostCountDelta: row.duplicatePostCount,
      ingestLagSecondsSumDelta: row.ingestLagSecondsSum,
      ingestLagSampleCountDelta: row.ingestLagSampleCount,
      providerDiffCountDelta: row.providerDiffCount,
      providerDiffSampleCountDelta: row.providerDiffSampleCount,
      errorCountDelta:
        row.errorCount ?? Math.max(0, row.requestCount - row.successCount),
      rateLimitCountDelta: row.rateLimitCount ?? 0,
      timeoutCountDelta: row.timeoutCount ?? 0,
      circuitOpenCountDelta: row.circuitOpenCount ?? 0,
      updatedAt: nowIso,
    });
  }

  await runRedditPhase1Cycle(
    {
      monitorTargetRepository,
      collectionJobRepository,
      rawEventRepository,
      accountRepository,
      contentRepository,
      providerHealthWindowRepository,
      metricsSnapshotRepository,
      subredditDailyFactRepository,
      subredditTrendPointRepository,
      redditConnector: connector,
      redditMapper: new DefaultRedditMapper(),
    },
    nowIso,
    {
      targetCanonicalNames: [`r/${subreddit}`],
      basePostLimit: 8,
      boostPostLimit: 24,
      boostWindowMinutes: 180,
      boostSurgeThreshold: 0.85,
      boostHeatChangeThreshold: 0.8,
      boostImpactMomentumThreshold: 0.7,
      boostMinDispersion: 0.45,
      boostMinHighScorePostCount: 2,
      boostCooldownWindows: args.boostCooldownWindows,
      disableAdaptiveSampling: false,
      providerHint: args.providerHint,
    },
  );

  return connector.requestedLimits[0] ?? 0;
}

test("adaptive sampling boosts on surge when dispersion gate is satisfied", async () => {
  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 0,
    points: [
      trendPoint({
        windowStart: "2026-04-10T10:00:00.000Z",
        windowEnd: "2026-04-10T10:59:59.000Z",
        surgeScore: 0.9,
        heatChangePct: 0.2,
        dispersionScore: 0.6,
        highScorePostCount: 1,
        sampledPostCount: 8,
        impactMomentum: 0.2,
      }),
    ],
  });

  assert.equal(limit, 24);
});

test("adaptive sampling does not boost on surge when dispersion is below threshold", async () => {
  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 0,
    points: [
      trendPoint({
        windowStart: "2026-04-10T10:00:00.000Z",
        windowEnd: "2026-04-10T10:59:59.000Z",
        surgeScore: 0.95,
        heatChangePct: 0.2,
        dispersionScore: 0.2,
        highScorePostCount: 1,
        sampledPostCount: 8,
        impactMomentum: 0.1,
      }),
    ],
  });

  assert.equal(limit, 8);
});

test("adaptive sampling boosts on heat-change only when high-score support is present", async () => {
  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 0,
    points: [
      trendPoint({
        windowStart: "2026-04-10T10:00:00.000Z",
        windowEnd: "2026-04-10T10:59:59.000Z",
        surgeScore: 0.2,
        heatChangePct: 0.9,
        dispersionScore: 0.2,
        highScorePostCount: 2,
        sampledPostCount: 8,
        impactMomentum: 0.1,
      }),
    ],
  });

  assert.equal(limit, 24);
});

test("adaptive sampling cooldown blocks repeated boost windows", async () => {
  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 2,
    points: [
      trendPoint({
        windowStart: "2026-04-10T10:00:00.000Z",
        windowEnd: "2026-04-10T10:59:59.000Z",
        surgeScore: 0.9,
        heatChangePct: 0.3,
        dispersionScore: 0.6,
        highScorePostCount: 1,
        sampledPostCount: 8,
        impactMomentum: 0.2,
      }),
      trendPoint({
        windowStart: "2026-04-10T11:00:00.000Z",
        windowEnd: "2026-04-10T11:59:59.000Z",
        surgeScore: 0.92,
        heatChangePct: 0.4,
        dispersionScore: 0.65,
        highScorePostCount: 1,
        sampledPostCount: 24,
        impactMomentum: 0.3,
      }),
    ],
  });

  assert.equal(limit, 8);
});

test("adaptive sampling for http-primary elevates on sustained coverage gap", async () => {
  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 0,
    providerHint: "http",
    points: [
      trendPoint({
        windowStart: "2026-04-10T10:00:00.000Z",
        windowEnd: "2026-04-10T10:59:59.000Z",
        surgeScore: 0.1,
        heatChangePct: 0.1,
        dispersionScore: 0.3,
        highScorePostCount: 1,
        sampledPostCount: 4,
        impactMomentum: 0.05,
      }),
    ],
  });

  assert.equal(limit, 18);
});

test("adaptive sampling boosts on leading-edge velocity before surge fully forms", async () => {
  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 0,
    providerHint: "http",
    points: [
      {
        ...trendPoint({
          windowStart: "2026-04-10T10:00:00.000Z",
          windowEnd: "2026-04-10T10:59:59.000Z",
          surgeScore: 0.35,
          heatChangePct: 0.22,
          dispersionScore: 0.48,
          highScorePostCount: 1,
          sampledPostCount: 6,
          impactMomentum: 0.25,
        }),
        newPosts: 14,
        deltaNewPostsVsPrevWindow: 7,
        activePostRatio: 0.44,
        velocityScore: 0.92,
        accelerationScore: 0.86,
        anomalyScore: 0.72,
        baselineDeviationScore: 0.61,
      },
    ],
  });

  assert.equal(limit, 24);
});

test("adaptive sampling for http-primary applies cold-start warmup without trend or health evidence", async () => {
  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 0,
    providerHint: "http",
    points: [],
  });

  assert.equal(limit, 16);
});

test("adaptive sampling for generic provider applies smaller cold-start warmup", async () => {
  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 0,
    providerHint: "apify",
    points: [],
  });

  assert.equal(limit, 12);
});

test("adaptive sampling for http-primary elevates on degraded transport evidence without trend points", async () => {
  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 0,
    providerHint: "http",
    points: [],
    providerHealthRows: [
      {
        provider: "http",
        requestCount: 12,
        successCount: 7,
        emptyResponseCount: 5,
        fallbackCount: 3,
        candidateCount: 48,
        acceptedCount: 36,
        filteredOutCount: 12,
        duplicatePostCount: 10,
        ingestLagSecondsSum: 12_600,
        ingestLagSampleCount: 7,
        providerDiffCount: 2,
        providerDiffSampleCount: 3,
      },
    ],
  });

  assert.equal(limit, 18);
});

test("adaptive sampling for http-primary elevates on timeout and circuit evidence", async () => {
  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 0,
    providerHint: "http",
    points: [],
    providerHealthRows: [
      {
        provider: "http",
        requestCount: 10,
        successCount: 7,
        emptyResponseCount: 0,
        fallbackCount: 0,
        candidateCount: 24,
        acceptedCount: 24,
        filteredOutCount: 0,
        duplicatePostCount: 0,
        ingestLagSecondsSum: 0,
        ingestLagSampleCount: 0,
        providerDiffCount: 0,
        providerDiffSampleCount: 0,
        errorCount: 3,
        rateLimitCount: 0,
        timeoutCount: 2,
        circuitOpenCount: 1,
      },
    ],
  });

  assert.equal(limit, 17);
});

test("adaptive sampling for http-primary treats exact timeout threshold as severe transport evidence", async () => {
  const requestCount = 10;
  const timeoutCount =
    PHASE1_SAMPLING_THRESHOLDS.severeTransportFailure.timeoutRateMin.httpPrimary * requestCount;
  const successCount = requestCount - timeoutCount;

  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 0,
    providerHint: "http",
    points: [],
    providerHealthRows: [
      {
        provider: "http",
        requestCount,
        successCount,
        emptyResponseCount: 0,
        fallbackCount: 0,
        candidateCount: 24,
        acceptedCount: 24,
        filteredOutCount: 0,
        duplicatePostCount: 0,
        ingestLagSecondsSum: 0,
        ingestLagSampleCount: 0,
        providerDiffCount: 0,
        providerDiffSampleCount: 0,
        errorCount: requestCount - successCount,
        rateLimitCount: 0,
        timeoutCount,
        circuitOpenCount: 0,
      },
    ],
  });

  assert.equal(limit, 17);
});

test("adaptive sampling for http-primary treats exact circuit-open threshold as severe transport evidence", async () => {
  const requestCount = 25;
  const circuitOpenCount =
    PHASE1_SAMPLING_THRESHOLDS.severeTransportFailure.circuitOpenRateMin.httpPrimary *
    requestCount;
  const successCount = requestCount - circuitOpenCount;

  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 0,
    providerHint: "http",
    points: [],
    providerHealthRows: [
      {
        provider: "http",
        requestCount,
        successCount,
        emptyResponseCount: 0,
        fallbackCount: 0,
        candidateCount: 24,
        acceptedCount: 24,
        filteredOutCount: 0,
        duplicatePostCount: 0,
        ingestLagSecondsSum: 0,
        ingestLagSampleCount: 0,
        providerDiffCount: 0,
        providerDiffSampleCount: 0,
        errorCount: requestCount - successCount,
        rateLimitCount: 0,
        timeoutCount: 0,
        circuitOpenCount,
      },
    ],
  });

  assert.equal(limit, 17);
});


test("adaptive sampling for http-primary treats exact rate-limit threshold as severe transport evidence", async () => {
  const requestCount = 50;
  const rateLimitCount =
    PHASE1_SAMPLING_THRESHOLDS.severeTransportFailure.rateLimitRateMin.httpPrimary *
    requestCount;
  const successCount = requestCount - rateLimitCount;

  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 0,
    providerHint: "http",
    points: [],
    providerHealthRows: [
      {
        provider: "http",
        requestCount,
        successCount,
        emptyResponseCount: 0,
        fallbackCount: 0,
        candidateCount: 24,
        acceptedCount: 24,
        filteredOutCount: 0,
        duplicatePostCount: 0,
        ingestLagSecondsSum: 0,
        ingestLagSampleCount: 0,
        providerDiffCount: 0,
        providerDiffSampleCount: 0,
        errorCount: requestCount - successCount,
        rateLimitCount,
        timeoutCount: 0,
        circuitOpenCount: 0,
      },
    ],
  });

  assert.equal(limit, 17);
});

test("adaptive sampling for http-primary treats exact error threshold as severe transport evidence", async () => {
  const requestCount = 50;
  const errorCount =
    PHASE1_SAMPLING_THRESHOLDS.severeTransportFailure.errorRateMin.httpPrimary *
    requestCount;
  const successCount = requestCount - errorCount;

  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 0,
    providerHint: "http",
    points: [],
    providerHealthRows: [
      {
        provider: "http",
        requestCount,
        successCount,
        emptyResponseCount: 0,
        fallbackCount: 0,
        candidateCount: 24,
        acceptedCount: 24,
        filteredOutCount: 0,
        duplicatePostCount: 0,
        ingestLagSecondsSum: 0,
        ingestLagSampleCount: 0,
        providerDiffCount: 0,
        providerDiffSampleCount: 0,
        errorCount,
        rateLimitCount: 0,
        timeoutCount: 0,
        circuitOpenCount: 0,
      },
    ],
  });

  assert.equal(limit, 17);
});
test("adaptive sampling for http-primary elevates on stale-head duplicate and lag evidence", async () => {
  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 0,
    providerHint: "http",
    points: [],
    providerHealthRows: [
      {
        provider: "http",
        requestCount: 3,
        successCount: 3,
        emptyResponseCount: 0,
        fallbackCount: 0,
        candidateCount: 40,
        acceptedCount: 40,
        filteredOutCount: 0,
        duplicatePostCount: 26,
        ingestLagSecondsSum: 630_000,
        ingestLagSampleCount: 3,
        providerDiffCount: 0,
        providerDiffSampleCount: 0,
        errorCount: 0,
        rateLimitCount: 0,
        timeoutCount: 0,
        circuitOpenCount: 0,
      },
    ],
  });

  assert.equal(limit, 18);
});

test("adaptive sampling for http-primary boosts on severe stale-head evidence", async () => {
  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 2,
    providerHint: "http",
    points: [
      trendPoint({
        windowStart: "2026-04-10T10:00:00.000Z",
        windowEnd: "2026-04-10T10:59:59.000Z",
        surgeScore: 0.9,
        heatChangePct: 0.4,
        dispersionScore: 0.7,
        highScorePostCount: 2,
        sampledPostCount: 24,
        impactMomentum: 0.4,
      }),
    ],
    providerHealthRows: [
      {
        provider: "http",
        requestCount: 3,
        successCount: 3,
        emptyResponseCount: 0,
        fallbackCount: 0,
        candidateCount: 40,
        acceptedCount: 40,
        filteredOutCount: 0,
        duplicatePostCount: 38,
        ingestLagSecondsSum: 600_000,
        ingestLagSampleCount: 3,
        providerDiffCount: 0,
        providerDiffSampleCount: 0,
        errorCount: 0,
        rateLimitCount: 0,
        timeoutCount: 0,
        circuitOpenCount: 0,
      },
    ],
  });

  assert.equal(limit, 24);
});

test("adaptive sampling for http-primary treats exact severe stale-head thresholds as boost", async () => {
  const requestCount = 20;
  const duplicatePostCount =
    PHASE1_SAMPLING_THRESHOLDS.staleHead.severeDuplicateRateMin.httpPrimary * requestCount;
  const ingestLagSecondsPerRequest =
    PHASE1_SAMPLING_THRESHOLDS.staleHead.severeIngestLagSecondsMin.httpPrimary;

  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 0,
    providerHint: "http",
    points: [],
    providerHealthRows: [
      {
        provider: "http",
        requestCount,
        successCount: requestCount,
        emptyResponseCount: 0,
        fallbackCount: 0,
        candidateCount: requestCount,
        acceptedCount: requestCount,
        filteredOutCount: 0,
        duplicatePostCount,
        ingestLagSecondsSum: ingestLagSecondsPerRequest * requestCount,
        ingestLagSampleCount: requestCount,
        providerDiffCount: 0,
        providerDiffSampleCount: 0,
        errorCount: 0,
        rateLimitCount: 0,
        timeoutCount: 0,
        circuitOpenCount: 0,
      },
    ],
  });

  assert.equal(limit, 24);
});

test("adaptive sampling for http-primary uses accepted-count fallback when candidate count is zero", async () => {
  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 0,
    providerHint: "http",
    points: [],
    providerHealthRows: [
      {
        provider: "http",
        requestCount: 4,
        successCount: 4,
        emptyResponseCount: 0,
        fallbackCount: 0,
        candidateCount: 0,
        acceptedCount: 20,
        filteredOutCount: 0,
        duplicatePostCount: 20,
        ingestLagSecondsSum: 21_600,
        ingestLagSampleCount: 4,
        providerDiffCount: 0,
        providerDiffSampleCount: 0,
        errorCount: 0,
        rateLimitCount: 0,
        timeoutCount: 0,
        circuitOpenCount: 0,
      },
    ],
  });

  assert.equal(limit, 18);
});

test("adaptive sampling for http-primary elevates on provider switch instability", async () => {
  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 0,
    providerHint: "http",
    points: [],
    providerHealthRows: [
      {
        provider: "http",
        requestCount: 6,
        successCount: 6,
        emptyResponseCount: 0,
        fallbackCount: 0,
        candidateCount: 18,
        acceptedCount: 18,
        filteredOutCount: 0,
        duplicatePostCount: 0,
        ingestLagSecondsSum: 0,
        ingestLagSampleCount: 0,
        providerDiffCount: 1,
        providerDiffSampleCount: 4,
        errorCount: 0,
        rateLimitCount: 0,
        timeoutCount: 0,
        circuitOpenCount: 0,
      },
      {
        provider: "apify",
        requestCount: 4,
        successCount: 4,
        emptyResponseCount: 0,
        fallbackCount: 0,
        candidateCount: 12,
        acceptedCount: 12,
        filteredOutCount: 0,
        duplicatePostCount: 0,
        ingestLagSecondsSum: 0,
        ingestLagSampleCount: 0,
        providerDiffCount: 0,
        providerDiffSampleCount: 0,
        errorCount: 0,
        rateLimitCount: 0,
        timeoutCount: 0,
        circuitOpenCount: 0,
      },
    ],
  });

  assert.equal(limit, 18);
});

test("adaptive sampling for http-primary treats exact provider switch thresholds as instability", async () => {
  const requestCount = 10;
  const switchShareCount =
    PHASE1_SAMPLING_THRESHOLDS.switchInstability.providerSwitchShareMin.httpPrimary * requestCount;

  const limit = await runCycleWithRecentPoints({
    boostCooldownWindows: 0,
    providerHint: "http",
    points: [],
    providerHealthRows: [
      {
        provider: "http",
        requestCount: requestCount - switchShareCount,
        successCount: requestCount - switchShareCount,
        emptyResponseCount: 0,
        fallbackCount: 0,
        candidateCount: 24,
        acceptedCount: 24,
        filteredOutCount: 0,
        duplicatePostCount: 0,
        ingestLagSecondsSum: 0,
        ingestLagSampleCount: 0,
        providerDiffCount: 2,
        providerDiffSampleCount: 15,
        errorCount: 0,
        rateLimitCount: 0,
        timeoutCount: 0,
        circuitOpenCount: 0,
      },
      {
        provider: "apify",
        requestCount: switchShareCount,
        successCount: switchShareCount,
        emptyResponseCount: 0,
        fallbackCount: 0,
        candidateCount: 6,
        acceptedCount: 6,
        filteredOutCount: 0,
        duplicatePostCount: 0,
        ingestLagSecondsSum: 0,
        ingestLagSampleCount: 0,
        providerDiffCount: 0,
        providerDiffSampleCount: 0,
        errorCount: 0,
        rateLimitCount: 0,
        timeoutCount: 0,
        circuitOpenCount: 0,
      },
    ],
  });

  assert.equal(limit, 18);
});

