import type {
  MarketTrendRankItem,
  MarketWorkbenchResponse,
} from "../../../packages/contracts/src/http";
import type { AnomalyEvent } from "../../domain/entities/anomaly-event";
import type { Content } from "../../domain/entities/content";
import type { MonitorTarget } from "../../domain/entities/monitor-target";
import type { PostGrowthFact } from "../../domain/entities/post-growth-fact";
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
