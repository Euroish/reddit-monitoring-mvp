import type {
  ApiReadinessQueueBucket,
  ApiReadinessResponse,
} from "../../../packages/contracts/src/http";
import type { CollectionJobRepository } from "../../../src/domain/repositories/collection-job-repository";
import type { CrawlCursorRepository } from "../../../src/domain/repositories/crawl-cursor-repository";
import type { KeywordQuerySessionRepository } from "../../../src/domain/repositories/keyword-query-session-repository";
import type { MetricsSnapshotRepository } from "../../../src/domain/repositories/metrics-snapshot-repository";
import type { MonitorTargetRepository } from "../../../src/domain/repositories/monitor-target-repository";
import type { ProviderHealthWindowRepository } from "../../../src/domain/repositories/provider-health-window-repository";
import type { SubredditDailyFactRepository } from "../../../src/domain/repositories/subreddit-daily-fact-repository";
import {
  resolveRedditTargetExecutionRoute,
  summarizeRedditRoutingPolicy,
  type RedditProviderRoutingPolicyContext,
} from "../../../src/runtime/reddit-provider-routing-policy";
import { READYZ_THRESHOLDS } from "./readyz-thresholds";

export const ACTIVE_SESSION_STATUSES = [
  "queued",
  "initial_ready",
  "live_refreshing",
] as const;

export interface ReadinessRepositoryBundle {
  monitorTargetRepository: MonitorTargetRepository;
  collectionJobRepository: CollectionJobRepository;
  crawlCursorRepository?: CrawlCursorRepository;
  keywordQuerySessionRepository?: KeywordQuerySessionRepository;
  metricsSnapshotRepository?: MetricsSnapshotRepository;
  subredditDailyFactRepository?: SubredditDailyFactRepository;
  providerHealthWindowRepository?: ProviderHealthWindowRepository;
}

export interface ReadinessState {
  isReady: boolean;
  status: ApiReadinessResponse["status"];
  checks: ApiReadinessResponse["checks"];
  queue: ApiReadinessResponse["queue"];
  observability: ApiReadinessResponse["observability"];
  activeSessions: number;
  activeTargets: number;
  degradedReasons: string[];
}

function toQueueBucket(args: {
  queuedDue: number;
  queuedDelayed: number;
  retryingDue: number;
  retryingDelayed: number;
  running: number;
  deadLetter: number;
}): ApiReadinessQueueBucket {
  return {
    backlog: args.queuedDue + args.retryingDue,
    scheduled: args.queuedDelayed + args.retryingDelayed,
    running: args.running,
    deadLetter: args.deadLetter,
  };
}

function toRate(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return Number((numerator / denominator).toFixed(6));
}

function toDuplicatePostRate(args: {
  duplicatePostCount: number;
  candidateCount: number;
  filteredOutCount: number;
  acceptedCount: number;
}): number | null {
  return toRate(
    args.duplicatePostCount,
    args.candidateCount > 0 ? args.candidateCount : args.acceptedCount,
  );
}

function toAverage(total: number, count: number): number | null {
  if (count <= 0) {
    return null;
  }
  return Number((total / count).toFixed(3));
}

function toProviderSwitchShare(
  totalRequestCount: number,
  providerRequestCount: number,
): number | null {
  if (totalRequestCount <= 0) {
    return null;
  }
  return Number(
    (((totalRequestCount - providerRequestCount) / totalRequestCount) || 0).toFixed(6),
  );
}

function isProviderStaleHeadElevated(args: {
  duplicatePostRate: number | null;
  ingestLagSeconds: number | null;
}): boolean {
  if (args.duplicatePostRate == null || args.ingestLagSeconds == null) {
    return false;
  }

  return (
    args.duplicatePostRate >= READYZ_THRESHOLDS.staleHeadDuplicatePostRateMin &&
    args.ingestLagSeconds >= READYZ_THRESHOLDS.staleHeadIngestLagSecondsMin
  );
}

function isScraplingDynamicFreshnessRecovered(args: {
  provider: string;
  requestCount: number;
  successRate: number;
  fallbackRate: number;
  emptyRate: number;
  errorRate: number;
  rateLimitRate: number;
  timeoutRate: number;
  circuitOpenRate: number;
  dynamicProfileShare: number | null;
  sessionKeyObservedRate: number | null;
  sessionKeyReuseRate: number | null;
}): boolean {
  if (args.provider !== "scrapling") {
    return false;
  }
  if (
    args.requestCount <
    READYZ_THRESHOLDS.scraplingTransportMinRequestCountForFallback
  ) {
    return false;
  }
  if (
    args.dynamicProfileShare == null ||
    args.dynamicProfileShare < READYZ_THRESHOLDS.scraplingDynamicProfileShareMin
  ) {
    return false;
  }
  if (
    args.sessionKeyObservedRate == null ||
    args.sessionKeyObservedRate <
      READYZ_THRESHOLDS.scraplingSessionKeyObservedRateMin
  ) {
    return false;
  }
  if (
    args.sessionKeyReuseRate == null ||
    args.sessionKeyReuseRate < READYZ_THRESHOLDS.scraplingSessionKeyReuseRateMin
  ) {
    return false;
  }

  return (
    args.successRate >= READYZ_THRESHOLDS.providerHealthSuccessRateMin &&
    args.fallbackRate <= READYZ_THRESHOLDS.providerHealthFallbackRateMax &&
    args.emptyRate <= READYZ_THRESHOLDS.providerHealthEmptyRateMax &&
    args.errorRate <= READYZ_THRESHOLDS.providerHealthErrorRateMax &&
    args.rateLimitRate <= READYZ_THRESHOLDS.providerHealthRateLimitRateMax &&
    args.timeoutRate <= READYZ_THRESHOLDS.providerHealthTimeoutRateMax &&
    args.circuitOpenRate <= READYZ_THRESHOLDS.providerHealthCircuitOpenRateMax
  );
}

function toLagSeconds(nowIso: string, observedAtIso: string | undefined): number | null {
  if (!observedAtIso) {
    return null;
  }
  const nowMs = new Date(nowIso).getTime();
  const observedAtMs = new Date(observedAtIso).getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(observedAtMs)) {
    return null;
  }
  return Math.max(0, Math.round((nowMs - observedAtMs) / 1000));
}

function toNullableRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Number((numerator / denominator).toFixed(6)) : null;
}

function createEmptyObservability(): ApiReadinessResponse["observability"] {
  return {
    fetchSuccessRate: null,
    fallbackRate: null,
    emptyWindowRate: null,
    duplicatePostRate: null,
    ingestLagSeconds: null,
    providerDiffRate: null,
    errorRate: null,
    rateLimitRate: null,
    timeoutRate: null,
    circuitOpenRate: null,
    providerSwitchShare: null,
    cursorStallRate: null,
    cursorLagSecondsMax: null,
    dailyFactCoverageRate: null,
    dailyFactLagDaysMax: null,
    scraplingEvidence: {
      requestCount: 0,
      sessionKeyObservedRate: null,
      sessionKeyReuseRate: null,
      byProfile: [],
    },
    routingPolicy: {
      defaultLiveProvider: null,
      targetCount: 0,
      promotedScraplingTargetCount: 0,
      demotedHttpTargetCount: 0,
      byProvider: [],
      byScraplingProfile: [],
    },
    byProvider: [],
  };
}

export async function buildReadinessState(args: {
  repositories: ReadinessRepositoryBundle;
  nowIso: string;
  routingPolicyContext?: RedditProviderRoutingPolicyContext;
}): Promise<ReadinessState> {
  const activeSessionUpdatedSinceIso = new Date(
    new Date(args.nowIso).getTime() -
      READYZ_THRESHOLDS.activeSessionLookbackMinutes * 60 * 1000,
  ).toISOString();
  const providerHealthFromIso = new Date(
    new Date(args.nowIso).getTime() -
      READYZ_THRESHOLDS.providerHealthLookbackMinutes * 60 * 1000,
  ).toISOString();
  let storageCheck: ApiReadinessResponse["checks"]["storage"] = "ok";
  let queueCheck: ApiReadinessResponse["checks"]["queue"] = "ok";
  let activeTargets = 0;
  let activeSubredditTargets: Array<{
    id: string;
    canonicalName: string;
  }> = [];
  let activeTargetIds: string[] = [];
  let activeSessions = 0;
  let queue: ApiReadinessResponse["queue"] = {
    backlog: 0,
    scheduled: 0,
    running: 0,
    deadLetter: 0,
    byMode: {
      live: { backlog: 0, scheduled: 0, running: 0, deadLetter: 0 },
      backfill: { backlog: 0, scheduled: 0, running: 0, deadLetter: 0 },
      default: { backlog: 0, scheduled: 0, running: 0, deadLetter: 0 },
    },
  };
  const observability = createEmptyObservability();
  const degradedReasons: string[] = [];
  const staleHeadProviders = new Set<string>();
  const recentLiveProviders = new Set<string>();
  const freshnessRecoveredProviders = new Set<string>();

  try {
    const targets = await args.repositories.monitorTargetRepository.findActiveSubreddits();
    activeTargets = targets.length;
    activeSubredditTargets = targets.map((target) => ({
      id: target.id,
      canonicalName: target.canonicalName,
    }));
    activeTargetIds = targets.map((target) => target.id);
  } catch {
    storageCheck = "error";
    degradedReasons.push("storage_unavailable");
  }

  try {
    const summary = await args.repositories.collectionJobRepository.getOperationalSummary(
      args.nowIso,
    );
    queue = {
      ...toQueueBucket(summary),
      byMode: {
        live: toQueueBucket(summary.byMode.live),
        backfill: toQueueBucket(summary.byMode.backfill),
        default: toQueueBucket(summary.byMode.default),
      },
    };
    if (summary.deadLetter > 0) {
      queueCheck = "degraded";
      degradedReasons.push("dead_letter_jobs_present");
    }
  } catch {
    queueCheck = "error";
    if (!degradedReasons.includes("queue_unavailable")) {
      degradedReasons.push("queue_unavailable");
    }
  }

  if (args.repositories.keywordQuerySessionRepository) {
    try {
      activeSessions = await args.repositories.keywordQuerySessionRepository.countActiveSessions({
        statuses: [...ACTIVE_SESSION_STATUSES],
        updatedSinceIso: activeSessionUpdatedSinceIso,
      });
    } catch {
      if (!degradedReasons.includes("keyword_session_observability_unavailable")) {
        degradedReasons.push("keyword_session_observability_unavailable");
      }
    }
  } else {
    activeSessions = queue.running;
  }

  if (args.repositories.providerHealthWindowRepository) {
    try {
      const aggregates =
        await args.repositories.providerHealthWindowRepository.summarizeByProviderInRange({
          from: providerHealthFromIso,
          to: args.nowIso,
          mode: "live",
        });
      for (const item of aggregates) {
        if (item.requestCount > 0) {
          recentLiveProviders.add(item.provider);
        }
      }
      const totals = aggregates.reduce(
        (summary, item) => {
          summary.requestCount += item.requestCount;
          summary.successCount += item.successCount;
          summary.emptyResponseCount += item.emptyResponseCount;
          summary.fallbackCount += item.fallbackCount;
          summary.candidateCount += item.candidateCount;
          summary.acceptedCount += item.acceptedCount;
          summary.filteredOutCount += item.filteredOutCount;
          summary.duplicatePostCount += item.duplicatePostCount;
          summary.ingestLagSecondsSum += item.ingestLagSecondsSum;
          summary.ingestLagSampleCount += item.ingestLagSampleCount;
          summary.providerDiffCount += item.providerDiffCount;
          summary.providerDiffSampleCount += item.providerDiffSampleCount;
          summary.errorCount += item.errorCount;
          summary.rateLimitCount += item.rateLimitCount;
          summary.timeoutCount += item.timeoutCount;
          summary.circuitOpenCount += item.circuitOpenCount;
          return summary;
        },
        {
          requestCount: 0,
          successCount: 0,
          emptyResponseCount: 0,
          fallbackCount: 0,
          candidateCount: 0,
          acceptedCount: 0,
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
      );
      observability.byProvider = aggregates.map((item) => ({
        provider: item.provider,
        mode: item.mode,
        fetchSuccessRate: toRate(item.successCount, item.requestCount),
        fallbackRate: toRate(item.fallbackCount, item.requestCount),
        emptyWindowRate: toRate(item.emptyResponseCount, item.requestCount),
        duplicatePostRate: toDuplicatePostRate({
          duplicatePostCount: item.duplicatePostCount,
          candidateCount: item.candidateCount,
          filteredOutCount: item.filteredOutCount,
          acceptedCount: item.acceptedCount,
        }),
        ingestLagSeconds: toAverage(item.ingestLagSecondsSum, item.ingestLagSampleCount),
        providerDiffRate: toRate(item.providerDiffCount, item.providerDiffSampleCount),
        errorRate: toRate(item.errorCount, item.requestCount),
        rateLimitRate: toRate(item.rateLimitCount, item.requestCount),
        timeoutRate: toRate(item.timeoutCount, item.requestCount),
        circuitOpenRate: toRate(item.circuitOpenCount, item.requestCount),
        providerSwitchShare: toProviderSwitchShare(totals.requestCount, item.requestCount),
        cursorStallRate: null,
        cursorLagSecondsMax: null,
      }));
      observability.fetchSuccessRate = toRate(totals.successCount, totals.requestCount);
      observability.fallbackRate = toRate(totals.fallbackCount, totals.requestCount);
      observability.emptyWindowRate = toRate(
        totals.emptyResponseCount,
        totals.requestCount,
      );
      observability.duplicatePostRate = toDuplicatePostRate({
        duplicatePostCount: totals.duplicatePostCount,
        candidateCount: totals.candidateCount,
        filteredOutCount: totals.filteredOutCount,
        acceptedCount: totals.acceptedCount,
      });
      observability.ingestLagSeconds = toAverage(
        totals.ingestLagSecondsSum,
        totals.ingestLagSampleCount,
      );
      observability.providerDiffRate = toRate(
        totals.providerDiffCount,
        totals.providerDiffSampleCount,
      );
      observability.errorRate = toRate(totals.errorCount, totals.requestCount);
      observability.rateLimitRate = toRate(totals.rateLimitCount, totals.requestCount);
      observability.timeoutRate = toRate(totals.timeoutCount, totals.requestCount);
      observability.circuitOpenRate = toRate(
        totals.circuitOpenCount,
        totals.requestCount,
      );
      const scraplingAggregate = aggregates.find(
        (item) => item.provider === "scrapling" && item.mode === "live",
      );
      if (scraplingAggregate) {
        observability.scraplingEvidence = {
          requestCount: scraplingAggregate.requestCount,
          sessionKeyObservedRate: toRate(
            scraplingAggregate.scraplingSessionKeyCount,
            scraplingAggregate.requestCount,
          ),
          sessionKeyReuseRate: toRate(
            scraplingAggregate.scraplingSessionKeyReuseCount,
            scraplingAggregate.scraplingSessionKeyCount,
          ),
          byProfile: [
            {
              profile: "http" as const,
              requestCount: scraplingAggregate.scraplingHttpProfileCount,
            },
            {
              profile: "dynamic" as const,
              requestCount: scraplingAggregate.scraplingDynamicProfileCount,
            },
            {
              profile: "stealth" as const,
              requestCount: scraplingAggregate.scraplingStealthProfileCount,
            },
          ].filter((item) => item.requestCount > 0),
        };
      }
      observability.providerSwitchShare = toProviderSwitchShare(
        totals.requestCount,
        Math.max(0, ...aggregates.map((item) => item.requestCount)),
      );
      for (const item of aggregates) {
        if (item.requestCount <= 0) {
          continue;
        }
        const successRate = item.successCount / item.requestCount;
        const fallbackRate = item.fallbackCount / item.requestCount;
        const emptyRate = item.emptyResponseCount / item.requestCount;
        const diffRate =
          item.providerDiffSampleCount > 0
            ? item.providerDiffCount / item.providerDiffSampleCount
            : 0;
        const errorRate = item.errorCount / item.requestCount;
        const rateLimitRate = item.rateLimitCount / item.requestCount;
        const timeoutRate = item.timeoutCount / item.requestCount;
        const circuitOpenRate = item.circuitOpenCount / item.requestCount;
        const dynamicProfileShare = toRate(
          item.scraplingDynamicProfileCount,
          item.requestCount,
        );
        const sessionKeyObservedRate = toRate(
          item.scraplingSessionKeyCount,
          item.requestCount,
        );
        const sessionKeyReuseRate = toRate(
          item.scraplingSessionKeyReuseCount,
          item.scraplingSessionKeyCount,
        );
        const scraplingDynamicFreshnessRecovered =
          isScraplingDynamicFreshnessRecovered({
            provider: item.provider,
            requestCount: item.requestCount,
            successRate,
            fallbackRate,
            emptyRate,
            errorRate,
            rateLimitRate,
            timeoutRate,
            circuitOpenRate,
            dynamicProfileShare,
            sessionKeyObservedRate,
            sessionKeyReuseRate,
          });
        const duplicatePostRate = toDuplicatePostRate({
          duplicatePostCount: item.duplicatePostCount,
          candidateCount: item.candidateCount,
          filteredOutCount: item.filteredOutCount,
          acceptedCount: item.acceptedCount,
        });
        const ingestLagSeconds = toAverage(
          item.ingestLagSecondsSum,
          item.ingestLagSampleCount,
        );
        const providerSwitchShare =
          totals.requestCount > 0
            ? (totals.requestCount - item.requestCount) / totals.requestCount
            : 0;
        if (successRate < READYZ_THRESHOLDS.providerHealthSuccessRateMin) {
          degradedReasons.push(`provider_fetch_success_low:${item.provider}`);
        }
        if (fallbackRate > READYZ_THRESHOLDS.providerHealthFallbackRateMax) {
          degradedReasons.push(`provider_fallback_elevated:${item.provider}`);
        }
        if (emptyRate > READYZ_THRESHOLDS.providerHealthEmptyRateMax) {
          degradedReasons.push(`provider_empty_window_elevated:${item.provider}`);
        }
        if (diffRate > READYZ_THRESHOLDS.providerHealthDiffRateMax) {
          degradedReasons.push(`provider_diff_elevated:${item.provider}`);
        }
        if (errorRate > READYZ_THRESHOLDS.providerHealthErrorRateMax) {
          degradedReasons.push(`provider_error_rate_elevated:${item.provider}`);
        }
        if (rateLimitRate > READYZ_THRESHOLDS.providerHealthRateLimitRateMax) {
          degradedReasons.push(`provider_rate_limit_elevated:${item.provider}`);
        }
        if (timeoutRate > READYZ_THRESHOLDS.providerHealthTimeoutRateMax) {
          degradedReasons.push(`provider_timeout_elevated:${item.provider}`);
        }
        if (circuitOpenRate > READYZ_THRESHOLDS.providerHealthCircuitOpenRateMax) {
          degradedReasons.push(`provider_circuit_open_elevated:${item.provider}`);
        }
        if (providerSwitchShare > READYZ_THRESHOLDS.providerHealthSwitchShareMax) {
          degradedReasons.push(`provider_switch_elevated:${item.provider}`);
        }
        if (scraplingDynamicFreshnessRecovered) {
          freshnessRecoveredProviders.add(item.provider);
        }
        if (isProviderStaleHeadElevated({ duplicatePostRate, ingestLagSeconds })) {
          if (scraplingDynamicFreshnessRecovered) {
            continue;
          }
          staleHeadProviders.add(item.provider);
          degradedReasons.push(`provider_stale_head_elevated:${item.provider}`);
        }
      }
    } catch {
      degradedReasons.push("provider_health_unavailable");
    }
  }

  if (args.repositories.crawlCursorRepository) {
    try {
      const liveCursors = (
        await args.repositories.crawlCursorRepository.list({
          mode: "live",
        })
      ).filter(
        (cursor) =>
          recentLiveProviders.size === 0 || recentLiveProviders.has(cursor.provider),
      );
      const byProvider = new Map<
        string,
        {
          totalCount: number;
          stalledCount: number;
          maxLagSeconds: number | null;
        }
      >();
      let totalCursorCount = 0;
      let stalledCursorCount = 0;
      let maxLagSeconds: number | null = null;

      for (const cursor of liveCursors) {
        const lagSeconds = toLagSeconds(
          args.nowIso,
          cursor.lastFetchedAt ?? cursor.updatedAt,
        );
        const current = byProvider.get(cursor.provider) ?? {
          totalCount: 0,
          stalledCount: 0,
          maxLagSeconds: null,
        };
        current.totalCount += 1;
        totalCursorCount += 1;

        if (lagSeconds != null) {
          current.maxLagSeconds =
            current.maxLagSeconds == null
              ? lagSeconds
              : Math.max(current.maxLagSeconds, lagSeconds);
          maxLagSeconds =
            maxLagSeconds == null ? lagSeconds : Math.max(maxLagSeconds, lagSeconds);
          if (lagSeconds > READYZ_THRESHOLDS.cursorStallThresholdSeconds) {
            current.stalledCount += 1;
            stalledCursorCount += 1;
          }
        }

        byProvider.set(cursor.provider, current);
      }

      observability.cursorStallRate = toNullableRate(stalledCursorCount, totalCursorCount);
      observability.cursorLagSecondsMax = maxLagSeconds;

      const existingProviders = new Set(observability.byProvider.map((item) => item.provider));
      observability.byProvider = observability.byProvider.map((item) => {
        const stats = byProvider.get(item.provider);
        return {
          ...item,
          cursorStallRate: stats ? toNullableRate(stats.stalledCount, stats.totalCount) : null,
          cursorLagSecondsMax: stats?.maxLagSeconds ?? null,
        };
      });
      for (const [provider, stats] of byProvider.entries()) {
        if (existingProviders.has(provider)) {
          continue;
        }
        observability.byProvider.push({
          provider,
          mode: "live",
          fetchSuccessRate: null,
          fallbackRate: null,
          emptyWindowRate: null,
          duplicatePostRate: null,
          ingestLagSeconds: null,
          providerDiffRate: null,
          errorRate: null,
          rateLimitRate: null,
          timeoutRate: null,
          circuitOpenRate: null,
          providerSwitchShare: null,
          cursorStallRate: toNullableRate(stats.stalledCount, stats.totalCount),
          cursorLagSecondsMax: stats.maxLagSeconds,
        });
      }
      for (const [provider, stats] of byProvider.entries()) {
        if (stats.stalledCount <= 0) {
          continue;
        }
        if (freshnessRecoveredProviders.has(provider)) {
          continue;
        }
        degradedReasons.push(`provider_cursor_stalled:${provider}`);
        if (staleHeadProviders.has(provider)) {
          degradedReasons.push(`provider_data_stalled:${provider}`);
        }
      }
    } catch {
      degradedReasons.push("crawl_cursor_observability_unavailable");
    }
  }

  if (
    activeTargetIds.length > 0 &&
    args.repositories.metricsSnapshotRepository &&
    args.repositories.subredditDailyFactRepository
  ) {
    try {
      const materializationFromIso = new Date(
        new Date(args.nowIso).getTime() - 36 * 60 * 60 * 1000,
      ).toISOString();
      const latestSnapshots =
        await args.repositories.metricsSnapshotRepository.listLatestByTargetsInRange({
          targetIds: activeTargetIds,
          from: materializationFromIso,
          to: args.nowIso,
          metricNames: ["new_posts_15m", "subscribers", "active_users"],
        });
      const latestFacts =
        await args.repositories.subredditDailyFactRepository.listLatestByTargetsInRange({
          targetIds: latestSnapshots.map((snapshot) => snapshot.targetId),
          fromDay: toUtcDay(materializationFromIso),
          toDay: toUtcDay(args.nowIso),
        });
      const latestFactByTarget = new Map(
        latestFacts.map((fact) => [fact.targetId, fact] as const),
      );
      let coveredTargets = 0;
      let maxLagDays: number | null = null;

      for (const snapshot of latestSnapshots) {
        const expectedDay = toUtcDay(snapshot.snapshotAt);
        const fact = latestFactByTarget.get(snapshot.targetId);
        const lagDays =
          fact && fact.day >= expectedDay
            ? 0
            : fact
              ? diffUtcDays(expectedDay, fact.day)
              : diffUtcDays(toUtcDay(args.nowIso), expectedDay) + 1;
        maxLagDays = maxLagDays == null ? lagDays : Math.max(maxLagDays, lagDays);
        if (fact && fact.day >= expectedDay) {
          coveredTargets += 1;
        }
      }

      observability.dailyFactCoverageRate = toRate(coveredTargets, latestSnapshots.length);
      observability.dailyFactLagDaysMax = maxLagDays;
      if (latestSnapshots.length > 0 && coveredTargets < latestSnapshots.length) {
        degradedReasons.push("algorithm_daily_fact_stale");
      }
    } catch {
      degradedReasons.push("algorithm_materialization_observability_unavailable");
    }
  }

  const routingPolicyContext = args.routingPolicyContext;
  if (routingPolicyContext && activeSubredditTargets.length > 0) {
    try {
      const routes = await Promise.all(
        activeSubredditTargets.map((target) =>
          resolveRedditTargetExecutionRoute({
            targetId: target.id,
            canonicalName: target.canonicalName,
            crawlMode: "live",
            nowIso: args.nowIso,
            defaultProviderHint: routingPolicyContext.defaultLiveProvider,
            providerHealthWindowRepository:
              args.repositories.providerHealthWindowRepository,
            crawlCursorRepository: args.repositories.crawlCursorRepository,
            policyContext: routingPolicyContext,
          }),
        ),
      );
      observability.routingPolicy = summarizeRedditRoutingPolicy(
        routes,
        routingPolicyContext,
      );
      if (observability.routingPolicy.demotedHttpTargetCount > 0) {
        degradedReasons.push("provider_policy_fallback_active");
      }
    } catch {
      degradedReasons.push("provider_policy_observability_unavailable");
    }
  } else if (routingPolicyContext) {
    observability.routingPolicy.defaultLiveProvider =
      routingPolicyContext.defaultLiveProvider;
  }

  const uniqueDegradedReasons = Array.from(new Set(degradedReasons));
  const isReady = storageCheck === "ok" && queueCheck !== "error";
  return {
    isReady,
    status: isReady
      ? uniqueDegradedReasons.length > 0
        ? "degraded"
        : "ready"
      : "not_ready",
    checks: {
      storage: storageCheck,
      queue: queueCheck,
    },
    queue,
    observability,
    activeSessions,
    activeTargets,
    degradedReasons: uniqueDegradedReasons,
  };
}

function toUtcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function diffUtcDays(laterDay: string, earlierDay: string): number {
  const laterMs = Date.parse(`${laterDay}T00:00:00.000Z`);
  const earlierMs = Date.parse(`${earlierDay}T00:00:00.000Z`);
  if (!Number.isFinite(laterMs) || !Number.isFinite(earlierMs)) {
    return 0;
  }
  return Math.max(0, Math.round((laterMs - earlierMs) / (24 * 60 * 60 * 1000)));
}
