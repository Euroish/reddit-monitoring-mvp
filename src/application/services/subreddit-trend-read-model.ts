import type { SubredditTrendPoint } from "../../domain/entities/subreddit-trend-point";

const TOP_MOVER_LIMIT = 5;
const RECENT_ANOMALY_LIMIT = 5;
const RISING_THRESHOLD = 0.2;
const FALLING_THRESHOLD = -0.2;
const ANOMALY_THRESHOLD = 0.5;

export type TrendDirection = "rising" | "flat" | "falling" | "unknown";

export interface SubredditTrendTimelineMeta {
  granularity: "6h";
  windowMinutes: 360;
  comparison: "previous_window";
  pointCount: number;
}

export interface SubredditTrendSummary {
  pointCount: number;
  latestWindowStart: string | null;
  latestWindowEnd: string | null;
  latestTrendScore: number | null;
  latestHeatIndex: number | null;
  latestSurgeScore: number | null;
  latestDispersionScore: number | null;
  latestTrendDirection: TrendDirection;
}

export interface TopMoverWindow {
  windowStart: string;
  windowEnd: string;
  deltaNewPostsVsPrevWindow: number;
  heatChangePct: number;
  heatIndex: number;
  surgeScore: number;
  trendScore: number;
}

export interface RecentAnomalyWindow {
  windowStart: string;
  windowEnd: string;
  heatIndex: number;
  surgeScore: number;
  anomalyScore: number;
  trendScore: number;
}

export interface SubredditTrendReadModel {
  timeline: SubredditTrendTimelineMeta;
  summary: SubredditTrendSummary;
  topMovers: TopMoverWindow[];
  recentAnomalies: RecentAnomalyWindow[];
}

export function buildSubredditTrendReadModel(points: SubredditTrendPoint[]): SubredditTrendReadModel {
  const sorted = [...points].sort((a, b) => a.windowStart.localeCompare(b.windowStart));
  const latest = sorted.length > 0 ? sorted[sorted.length - 1] : null;

  const topMovers = [...sorted]
    .sort((a, b) => {
      const absHeatChangeDiff = Math.abs(resolveHeatChangePct(b)) - Math.abs(resolveHeatChangePct(a));
      if (absHeatChangeDiff !== 0) {
        return absHeatChangeDiff;
      }
      return b.windowStart.localeCompare(a.windowStart);
    })
    .slice(0, TOP_MOVER_LIMIT)
    .map((point) => ({
      windowStart: point.windowStart,
      windowEnd: point.windowEnd,
      deltaNewPostsVsPrevWindow: point.deltaNewPostsVsPrevWindow,
      heatChangePct: resolveHeatChangePct(point),
      heatIndex: point.heatIndex ?? 0,
      surgeScore: point.surgeScore ?? 0,
      trendScore: point.trendScore,
    }));

  const recentAnomalies = [...sorted]
    .filter((point) => Math.max(point.anomalyScore ?? 0, point.surgeScore ?? 0) >= ANOMALY_THRESHOLD)
    .sort((a, b) => {
      const surgeDiff = (b.surgeScore ?? 0) - (a.surgeScore ?? 0);
      if (surgeDiff !== 0) {
        return surgeDiff;
      }
      return b.windowStart.localeCompare(a.windowStart);
    })
    .slice(0, RECENT_ANOMALY_LIMIT)
    .map((point) => ({
      windowStart: point.windowStart,
      windowEnd: point.windowEnd,
      heatIndex: point.heatIndex ?? 0,
      surgeScore: point.surgeScore ?? 0,
      anomalyScore: point.anomalyScore ?? 0,
      trendScore: point.trendScore,
    }));

  return {
    timeline: {
      granularity: "6h",
      windowMinutes: 360,
      comparison: "previous_window",
      pointCount: sorted.length,
    },
    summary: {
      pointCount: sorted.length,
      latestWindowStart: latest?.windowStart ?? null,
      latestWindowEnd: latest?.windowEnd ?? null,
      latestTrendScore: latest?.trendScore ?? null,
      latestHeatIndex: latest?.heatIndex ?? null,
      latestSurgeScore: latest?.surgeScore ?? null,
      latestDispersionScore: latest?.dispersionScore ?? null,
      latestTrendDirection: resolveTrendDirection(latest?.trendScore),
    },
    topMovers,
    recentAnomalies,
  };
}

function resolveTrendDirection(trendScore?: number): TrendDirection {
  if (trendScore == null) {
    return "unknown";
  }
  if (trendScore >= RISING_THRESHOLD) {
    return "rising";
  }
  if (trendScore <= FALLING_THRESHOLD) {
    return "falling";
  }
  return "flat";
}

function resolveHeatChangePct(point: SubredditTrendPoint): number {
  if (typeof point.heatChangePct === "number") {
    return point.heatChangePct;
  }
  if (point.newPosts === 0) {
    return 0;
  }
  return point.deltaNewPostsVsPrevWindow / Math.max(point.newPosts, 1);
}
