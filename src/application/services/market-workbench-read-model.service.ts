import type {
  MarketWorkbenchTargetStatusItem,
  MarketTrendRankItem,
  MarketWorkbenchResponse,
} from "../../../packages/contracts/src/http";
import type { AnomalyEvent } from "../../domain/entities/anomaly-event";
import type { Content } from "../../domain/entities/content";
import type { CrawlCursor } from "../../domain/entities/crawl-cursor";
import type { MonitorTarget } from "../../domain/entities/monitor-target";
import type { PostGrowthFact } from "../../domain/entities/post-growth-fact";
import type { ProviderHealthWindow } from "../../domain/entities/provider-health-window";
import type { SubredditCollectionCoverage } from "../../domain/entities/subreddit-collection-coverage";
import type { SubredditDailyFact } from "../../domain/entities/subreddit-daily-fact";
import type { SubredditTrendPoint } from "../../domain/entities/subreddit-trend-point";
import { buildAnomalyEventId } from "./anomaly-event-id";
import { resolveAnomalySeverity } from "./anomaly-severity";
import { buildSubredditDriverPostReadModel } from "./subreddit-driver-post-read-model.service";

export function buildMarketWorkbenchReadModel(args: {
  requestId: string;
  generatedAtIso: string;
  fromIso: string;
  toIso: string;
  targets: MonitorTarget[];
  latestTrendPoints: SubredditTrendPoint[];
  latestDailyFactsByTargetId: ReadonlyMap<string, SubredditDailyFact | undefined>;
  latestCoverageByTargetId: ReadonlyMap<string, SubredditCollectionCoverage | undefined>;
  liveCursorByTargetId: ReadonlyMap<string, CrawlCursor | null | undefined>;
  backfillCursorByTargetId: ReadonlyMap<string, CrawlCursor | null | undefined>;
  latestLiveHealthByTargetId: ReadonlyMap<string, ProviderHealthWindow | undefined>;
  breakoutFactsByTargetId: ReadonlyMap<string, readonly PostGrowthFact[]>;
  breakoutContentsByTargetId: ReadonlyMap<string, readonly Content[]>;
  anomalyEventsByTargetId: ReadonlyMap<string, readonly AnomalyEvent[]>;
  rankingLimit: number;
  breakoutLimit: number;
  anomalyLimit: number;
}): MarketWorkbenchResponse {
  const targetById = new Map(args.targets.map((target) => [target.id, target] as const));
  const leaders = buildLeaderSections({
    points: args.latestTrendPoints,
    targetById,
    rankingLimit: args.rankingLimit,
  });
  const latestTrendPointByTargetId = new Map(
    args.latestTrendPoints.map((point) => [point.targetId, point] as const),
  );
  const targets = buildTargetStatuses({
    generatedAtIso: args.generatedAtIso,
    targets: args.targets,
    latestTrendPointByTargetId,
    latestDailyFactsByTargetId: args.latestDailyFactsByTargetId,
    latestCoverageByTargetId: args.latestCoverageByTargetId,
    liveCursorByTargetId: args.liveCursorByTargetId,
    backfillCursorByTargetId: args.backfillCursorByTargetId,
    latestLiveHealthByTargetId: args.latestLiveHealthByTargetId,
  });
  const breakouts = buildBreakouts({
    breakoutFactsByTargetId: args.breakoutFactsByTargetId,
    breakoutContentsByTargetId: args.breakoutContentsByTargetId,
    breakoutLimit: args.breakoutLimit,
    targetById,
  });
  const anomalies = buildAnomalies({
    anomalyEventsByTargetId: args.anomalyEventsByTargetId,
    anomalyLimit: args.anomalyLimit,
    targetById,
  });

  return {
    ok: true,
    requestId: args.requestId,
    generatedAtIso: args.generatedAtIso,
    fromIso: args.fromIso,
    toIso: args.toIso,
    coverage: {
      scope: "monitored_targets",
      label: "Monitored market board",
      description:
        "Sections are computed only across active monitored subreddits with materialized ranking, breakout, or anomaly evidence in the requested range.",
      monitoredTargetCount: args.targets.length,
    },
    summary: {
      rankedTargetCount: leaders.byHeat.length,
      breakoutCount: breakouts.length,
      anomalyCount: anomalies.length,
    },
    leaders,
    targets,
    breakouts,
    anomalies,
  };
}

function buildLeaderSections(args: {
  points: SubredditTrendPoint[];
  targetById: ReadonlyMap<string, MonitorTarget>;
  rankingLimit: number;
}): MarketWorkbenchResponse["leaders"] {
  const rankItems = args.points
    .map((point) => {
      const target = args.targetById.get(point.targetId);
      if (!target) {
        return null;
      }
      const item: MarketTrendRankItem = {
        targetId: point.targetId,
        canonicalName: target.canonicalName,
        windowStart: point.windowStart,
        windowEnd: point.windowEnd,
        newPosts: point.newPosts,
        sampledPostCount: point.sampledPostCount ?? 0,
        heatIndex: point.heatIndex ?? 0,
        heatChangePct: point.heatChangePct ?? 0,
        surgeScore: point.surgeScore ?? 0,
        dispersionScore: point.dispersionScore ?? 0,
        trendScore: point.trendScore,
      };
      return item;
    })
    .filter((item): item is MarketTrendRankItem => item !== null);

  return {
    byHeat: [...rankItems]
      .sort((a, b) => {
        const byHeat = b.heatIndex - a.heatIndex;
        if (byHeat !== 0) {
          return byHeat;
        }
        return b.windowStart.localeCompare(a.windowStart);
      })
      .slice(0, args.rankingLimit),
    bySurge: [...rankItems]
      .sort((a, b) => {
        const bySurge = b.surgeScore - a.surgeScore;
        if (bySurge !== 0) {
          return bySurge;
        }
        return b.windowStart.localeCompare(a.windowStart);
      })
      .slice(0, args.rankingLimit),
    byDispersion: [...rankItems]
      .sort((a, b) => {
        const byDispersion = b.dispersionScore - a.dispersionScore;
        if (byDispersion !== 0) {
          return byDispersion;
        }
        return b.windowStart.localeCompare(a.windowStart);
      })
      .slice(0, args.rankingLimit),
  };
}

function buildBreakouts(args: {
  breakoutFactsByTargetId: ReadonlyMap<string, readonly PostGrowthFact[]>;
  breakoutContentsByTargetId: ReadonlyMap<string, readonly Content[]>;
  breakoutLimit: number;
  targetById: ReadonlyMap<string, MonitorTarget>;
}): MarketWorkbenchResponse["breakouts"] {
  const rows: MarketWorkbenchResponse["breakouts"] = [];

  for (const [targetId, facts] of args.breakoutFactsByTargetId.entries()) {
    const target = args.targetById.get(targetId);
    if (!target || facts.length === 0) {
      continue;
    }
    const contents = args.breakoutContentsByTargetId.get(targetId) ?? [];
    const drivers = buildSubredditDriverPostReadModel({
      facts: facts.slice(0, 1),
      contents: [...contents],
    });
    const topDriver = drivers[0];
    if (!topDriver) {
      continue;
    }
    rows.push({
      targetId,
      canonicalName: target.canonicalName,
      observedAt: topDriver.observedAt,
      ageBucket: topDriver.ageBucket,
      driverScore: topDriver.driverScore,
      velocityZScore: topDriver.velocityZScore,
      title: topDriver.title,
      permalink: topDriver.permalink,
      createdAtSource: topDriver.createdAtSource,
      labels: topDriver.labels,
    });
  }

  return rows
    .sort((a, b) => {
      const byDriver = b.driverScore - a.driverScore;
      if (byDriver !== 0) {
        return byDriver;
      }
      const byVelocity = b.velocityZScore - a.velocityZScore;
      if (byVelocity !== 0) {
        return byVelocity;
      }
      return b.observedAt.localeCompare(a.observedAt);
    })
      .slice(0, args.breakoutLimit);
}

function buildTargetStatuses(args: {
  generatedAtIso: string;
  targets: MonitorTarget[];
  latestTrendPointByTargetId: ReadonlyMap<string, SubredditTrendPoint>;
  latestDailyFactsByTargetId: ReadonlyMap<string, SubredditDailyFact | undefined>;
  latestCoverageByTargetId: ReadonlyMap<string, SubredditCollectionCoverage | undefined>;
  liveCursorByTargetId: ReadonlyMap<string, CrawlCursor | null | undefined>;
  backfillCursorByTargetId: ReadonlyMap<string, CrawlCursor | null | undefined>;
  latestLiveHealthByTargetId: ReadonlyMap<string, ProviderHealthWindow | undefined>;
}): MarketWorkbenchResponse["targets"] {
  return args.targets
    .map((target): MarketWorkbenchTargetStatusItem => {
      const latestTrendPoint = args.latestTrendPointByTargetId.get(target.id);
      const latestDailyFact = args.latestDailyFactsByTargetId.get(target.id);
      const latestCoverage = args.latestCoverageByTargetId.get(target.id);
      const liveCursor = args.liveCursorByTargetId.get(target.id) ?? null;
      const backfillCursor = args.backfillCursorByTargetId.get(target.id) ?? null;
      const latestLiveHealth = args.latestLiveHealthByTargetId.get(target.id);
      const live = summarizeLiveCoverage(liveCursor);
      const backfill = summarizeBackfillCoverage(backfillCursor);
      const reliability = summarizeReliability(latestLiveHealth);
      return {
        targetId: target.id,
        canonicalName: target.canonicalName,
        status: target.status,
        ...(latestDailyFact ? { latestObservedDay: latestDailyFact.day } : {}),
        ...(latestDailyFact ? { latestObservedPosts: latestDailyFact.postVolume } : {}),
        ...(latestDailyFact ? { latestQualifiedPosts: latestDailyFact.qualifiedPostVolume } : {}),
        ...(typeof latestTrendPoint?.heatIndex === "number"
          ? { latestHeatIndex: latestTrendPoint.heatIndex }
          : {}),
        ...(typeof latestTrendPoint?.trendScore === "number"
          ? { latestTrendScore: latestTrendPoint.trendScore }
          : {}),
        ...(latestCoverage ? { latestCoverageDay: latestCoverage.day } : {}),
        ...(latestCoverage ? { latestCoverageStatus: latestCoverage.coverageStatus } : {}),
        ...(latestCoverage ? { latestCoverageBasis: latestCoverage.coverageBasis } : {}),
        ...(liveCursor?.lastFetchedAt ? { lastLiveFetchedAt: liveCursor.lastFetchedAt } : {}),
        ...(backfillCursor?.lastFetchedAt ? { lastBackfillFetchedAt: backfillCursor.lastFetchedAt } : {}),
        stale: isTargetStatusStale({
          generatedAtIso: args.generatedAtIso,
          liveCursor,
          latestTrendPoint,
          latestDailyFact,
        }),
        live,
        backfill,
        reliability,
      };
    })
    .sort((a, b) => {
      const byStatus = Number(a.stale) - Number(b.stale);
      if (byStatus !== 0) {
        return byStatus;
      }
      return a.canonicalName.localeCompare(b.canonicalName);
    });
}

function buildAnomalies(args: {
  anomalyEventsByTargetId: ReadonlyMap<string, readonly AnomalyEvent[]>;
  anomalyLimit: number;
  targetById: ReadonlyMap<string, MonitorTarget>;
}): MarketWorkbenchResponse["anomalies"] {
  const rows: MarketWorkbenchResponse["anomalies"] = [];

  for (const [targetId, events] of args.anomalyEventsByTargetId.entries()) {
    const target = args.targetById.get(targetId);
    if (!target) {
      continue;
    }
    for (const event of events) {
      rows.push({
        targetId,
        canonicalName: target.canonicalName,
        eventId: buildAnomalyEventId(event),
        signalType: event.signalType,
        signalKey: event.signalKey,
        observedAt: event.observedAt,
        anomalyScore: event.anomalyScore,
        severity: resolveAnomalySeverity(event.anomalyScore),
      });
    }
  }

  return rows
    .sort((a, b) => {
      const byScore = b.anomalyScore - a.anomalyScore;
      if (byScore !== 0) {
        return byScore;
      }
      return b.observedAt.localeCompare(a.observedAt);
    })
      .slice(0, args.anomalyLimit);
}

function summarizeLiveCoverage(
  liveCursor?: CrawlCursor | null,
): MarketWorkbenchTargetStatusItem["live"] {
  if (!liveCursor || liveCursor.mode !== "live") {
    return {
      status: "missing",
    };
  }

  return {
    status: liveCursor.liveCoverageStatus ?? "partial",
    provider: liveCursor.provider,
    ...(liveCursor.liveRequestedFromIso
      ? { requestedFromIso: liveCursor.liveRequestedFromIso }
      : {}),
    ...(liveCursor.oldestObservedAt
      ? { oldestObservedAt: liveCursor.oldestObservedAt }
      : {}),
    ...(liveCursor.newestObservedAt
      ? { newestObservedAt: liveCursor.newestObservedAt }
      : {}),
    ...(typeof liveCursor.liveListingHorizonHit === "boolean"
      ? { listingHorizonHit: liveCursor.liveListingHorizonHit }
      : {}),
    ...(liveCursor.oldestObservedAt && liveCursor.newestObservedAt
      ? {
          observedHourSpan:
            Math.max(
              1,
              Math.floor(
                (Date.parse(liveCursor.newestObservedAt) -
                  Date.parse(liveCursor.oldestObservedAt)) /
                  (60 * 60 * 1000),
              ) + 1,
            ) || 1,
        }
      : {}),
    updatedAt: liveCursor.updatedAt,
  };
}

function summarizeBackfillCoverage(
  backfillCursor?: CrawlCursor | null,
): MarketWorkbenchTargetStatusItem["backfill"] {
  if (!backfillCursor || backfillCursor.mode !== "backfill") {
    return {
      status: "missing",
    };
  }

  return {
    status: backfillCursor.backfillCoverageStatus ?? "progressing",
    ...(backfillCursor.backfillStopReason
      ? { stopReason: backfillCursor.backfillStopReason }
      : {}),
    provider: backfillCursor.provider,
    ...(backfillCursor.backfillTargetFromIso
      ? { targetFromIso: backfillCursor.backfillTargetFromIso }
      : {}),
    ...(backfillCursor.oldestObservedAt
      ? { oldestObservedAt: backfillCursor.oldestObservedAt }
      : {}),
    ...(backfillCursor.newestObservedAt
      ? { newestObservedAt: backfillCursor.newestObservedAt }
      : {}),
    ...(backfillCursor.oldestObservedAt && backfillCursor.newestObservedAt
      ? {
          observedDaySpan:
            Math.max(
              1,
              Math.floor(
                (Date.parse(backfillCursor.newestObservedAt) -
                  Date.parse(backfillCursor.oldestObservedAt)) /
                  (24 * 60 * 60 * 1000),
              ) + 1,
            ) || 1,
        }
      : {}),
    updatedAt: backfillCursor.updatedAt,
  };
}

function summarizeReliability(
  latestLiveHealth: ProviderHealthWindow | undefined,
): MarketWorkbenchTargetStatusItem["reliability"] {
  if (!latestLiveHealth) {
    return {
      provider: null,
      mode: null,
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      timeoutCount: 0,
      circuitOpenCount: 0,
      duplicatePostRate: null,
      ingestLagSecondsAvg: null,
    };
  }

  return {
    provider: latestLiveHealth.provider,
    mode: latestLiveHealth.mode,
    requestCount: latestLiveHealth.requestCount,
    successCount: latestLiveHealth.successCount,
    errorCount: latestLiveHealth.errorCount,
    timeoutCount: latestLiveHealth.timeoutCount,
    circuitOpenCount: latestLiveHealth.circuitOpenCount,
    duplicatePostRate:
      latestLiveHealth.candidateCount > 0
        ? Number((latestLiveHealth.duplicatePostCount / latestLiveHealth.candidateCount).toFixed(6))
        : latestLiveHealth.acceptedCount > 0
          ? Number((latestLiveHealth.duplicatePostCount / latestLiveHealth.acceptedCount).toFixed(6))
          : null,
    ingestLagSecondsAvg:
      latestLiveHealth.ingestLagSampleCount > 0
        ? Number(
            (latestLiveHealth.ingestLagSecondsSum / latestLiveHealth.ingestLagSampleCount).toFixed(3),
          )
        : null,
    updatedAt: latestLiveHealth.updatedAt,
  };
}

function isTargetStatusStale(args: {
  generatedAtIso: string;
  liveCursor: CrawlCursor | null;
  latestTrendPoint?: SubredditTrendPoint;
  latestDailyFact?: SubredditDailyFact;
}): boolean {
  const referenceIso =
    args.liveCursor?.lastFetchedAt ??
    args.latestTrendPoint?.windowEnd ??
    (args.latestDailyFact ? `${args.latestDailyFact.day}T23:59:59.999Z` : undefined);
  if (!referenceIso) {
    return true;
  }
  const generatedAtMs = Date.parse(args.generatedAtIso);
  const referenceMs = Date.parse(referenceIso);
  if (!Number.isFinite(generatedAtMs) || !Number.isFinite(referenceMs)) {
    return true;
  }
  return generatedAtMs - referenceMs > 36 * 60 * 60 * 1000;
}
