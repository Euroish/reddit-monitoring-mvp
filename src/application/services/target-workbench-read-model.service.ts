import type { TargetWorkbenchResponse } from "../../../packages/contracts/src/http";
import type { AnomalyEvent } from "../../domain/entities/anomaly-event";
import type { Content } from "../../domain/entities/content";
import type { KeywordTrendDaily } from "../../domain/entities/keyword-trend-daily";
import type { MonitorTarget } from "../../domain/entities/monitor-target";
import type { PostGrowthFact } from "../../domain/entities/post-growth-fact";
import type { ProviderHealthWindow } from "../../domain/entities/provider-health-window";
import type { SubredditDailyFact } from "../../domain/entities/subreddit-daily-fact";
import type { SubredditTrendPoint } from "../../domain/entities/subreddit-trend-point";
import { buildSubredditAnomalyFeedReadModel } from "./subreddit-anomaly-feed-read-model.service";
import { buildSubredditDailyInsights } from "./subreddit-daily-insights.service";
import { buildSubredditDriverPostReadModel } from "./subreddit-driver-post-read-model.service";

type WorkbenchSeriesId = TargetWorkbenchResponse["series"][number]["id"];

const SERIES_DEFS: Array<{
  id: WorkbenchSeriesId;
  label: string;
  family: "trend" | "activity";
  unit: "score" | "count";
  defaultVisible: boolean;
  chartType: "line" | "bar";
  axis: "primary" | "secondary";
  description: string;
}> = [
  {
    id: "heat_price",
    label: "Heat Price",
    family: "trend",
    unit: "score",
    defaultVisible: true,
    chartType: "line",
    axis: "primary",
    description: "Normalized heat signal from daily subreddit activity and quality facts.",
  },
  {
    id: "ema_7",
    label: "EMA 7",
    family: "trend",
    unit: "score",
    defaultVisible: true,
    chartType: "line",
    axis: "primary",
    description: "Seven-day exponential moving average for heat price.",
  },
  {
    id: "ema_30",
    label: "EMA 30",
    family: "trend",
    unit: "score",
    defaultVisible: true,
    chartType: "line",
    axis: "primary",
    description: "Thirty-day exponential moving average for heat price.",
  },
  {
    id: "total_new_posts",
    label: "Total New Posts",
    family: "activity",
    unit: "count",
    defaultVisible: false,
    chartType: "bar",
    axis: "secondary",
    description: "Total new posts observed in the daily materialized fact.",
  },
  {
    id: "qualified_post_count",
    label: "Qualified Posts",
    family: "activity",
    unit: "count",
    defaultVisible: false,
    chartType: "bar",
    axis: "secondary",
    description: "Posts that passed the configured quality threshold for the day.",
  },
];

export function buildTargetWorkbenchReadModel(args: {
  requestId: string;
  generatedAtIso: string;
  target: MonitorTarget;
  fromIso: string;
  toIso: string;
  timeframe?: "1d";
  rangePreset?: "7d" | "30d" | "90d";
  dailyFacts: SubredditDailyFact[];
  trendPoints: SubredditTrendPoint[];
  keywordDailyRows: KeywordTrendDaily[];
  postGrowthFacts: PostGrowthFact[];
  contents: Content[];
  anomalyEvents: AnomalyEvent[];
  providerHealthWindows: ProviderHealthWindow[];
  keywords?: string[];
  normalizedQueries?: Array<{
    raw: string;
    normalizedQueryText: string;
    queryScope: "subreddit" | "global";
    scopeCanonicalSubreddit?: string;
  }>;
  matchedQueriesByContentId?: ReadonlyMap<string, readonly string[]>;
  keywordLimit?: number;
  driverLimit?: number;
  anomalyLimit?: number;
}): TargetWorkbenchResponse {
  const dailyInsights = buildSubredditDailyInsights({
    dailyFacts: args.dailyFacts,
    points: args.trendPoints,
    posts: [],
    keywordDailyRows: args.keywordDailyRows,
    fromIso: args.fromIso,
    toIso: args.toIso,
    keywords: args.keywords ?? [],
    keywordLimit: args.keywordLimit ?? 10,
  });
  const drivers = buildSubredditDriverPostReadModel({
    facts: args.postGrowthFacts,
    contents: args.contents,
    matchedQueriesByContentId: args.matchedQueriesByContentId,
  })
    .slice(0, args.driverLimit ?? 10)
    .map((driver) => ({
      id: driver.id,
      externalId: driver.externalId,
      title: driver.title,
      permalink: driver.permalink,
      createdAtSource: driver.createdAtSource,
      url: driver.url,
      bodySnippet: driver.bodyText?.slice(0, 240),
      observedAt: driver.observedAt,
      ageBucket: driver.ageBucket,
      ageMinutes: driver.ageMinutes,
      score: driver.score,
      comments: driver.comments,
      scoreVelocityPerHour: driver.scoreVelocityPerHour,
      commentVelocityPerHour: driver.commentVelocityPerHour,
      velocityZScore: driver.velocityZScore,
      driverScore: driver.driverScore,
      labels: driver.labels,
      matchedQueries: driver.matchedQueries,
      algorithmVersion: driver.algorithmVersion,
      explainPayload: driver.explainPayload,
    }));
  const anomalies = buildSubredditAnomalyFeedReadModel({
    events: args.anomalyEvents,
    limit: args.anomalyLimit ?? 10,
  }).events;
  const latestPointAt = dailyInsights.daily.at(-1)?.day;
  const materializedFactDays = new Set(args.dailyFacts.map((fact) => fact.day));
  const overlays = dailyInsights.keywordHeat.map((keyword) => ({
    id: `keyword_heat:${keyword.queryScope}:${keyword.keyword}`,
    label: keyword.keyword,
    kind: "keyword_heat" as const,
    queryScope: keyword.queryScope,
    points: keyword.daily.map((point) => ({
      at: point.day,
      value: point.mentions,
    })),
  }));
  const overlayIds = new Set(overlays.map((overlay) => overlay.id));
  const matchedDriverCountByQuery = new Map<string, number>();
  for (const driver of drivers) {
    for (const query of driver.matchedQueries ?? []) {
      matchedDriverCountByQuery.set(query, (matchedDriverCountByQuery.get(query) ?? 0) + 1);
    }
  }

  return {
    ok: true,
    requestId: args.requestId,
    generatedAtIso: args.generatedAtIso,
    target: {
      targetId: args.target.id,
      canonicalName: args.target.canonicalName,
      displayName: args.target.canonicalName.replace(/^r\//, "r/"),
      targetType: "subreddit",
    },
    range: {
      fromIso: dailyInsights.fromIso,
      toIso: dailyInsights.toIso,
      grain: "day",
      dayCount: dailyInsights.dayCount,
      timeframe: args.timeframe ?? "1d",
      ...(args.rangePreset ? { rangePreset: args.rangePreset } : {}),
    },
    availableTimeframes: [
      { id: "1d", label: "1D", grain: "day", enabled: true },
      {
        id: "6h",
        label: "6H",
        grain: "hour",
        enabled: false,
        reason: "Requires persisted intraday workbench facts.",
      },
      {
        id: "1h",
        label: "1H",
        grain: "hour",
        enabled: false,
        reason: "Requires persisted intraday workbench facts.",
      },
    ],
    availableRanges: [
      { id: "7d", label: "7D", dayCount: 7, defaultSelected: args.rangePreset === "7d" },
      { id: "30d", label: "30D", dayCount: 30, defaultSelected: args.rangePreset === "30d" },
      { id: "90d", label: "90D", dayCount: 90, defaultSelected: args.rangePreset === "90d" },
    ],
    indicators: SERIES_DEFS,
    series: SERIES_DEFS.map((definition) => ({
      id: definition.id,
      label: definition.label,
      family: definition.family,
      unit: definition.unit,
      points: dailyInsights.daily.map((point) => ({
        at: point.day,
        value: valueForSeries(definition.id, point),
      })),
    })),
    overlays,
    queryContext: {
      requested: (args.normalizedQueries ?? []).map((query) => {
        const overlayId = `keyword_heat:${query.queryScope}:${query.normalizedQueryText}`;
        return {
          raw: query.raw,
          normalizedQueryText: query.normalizedQueryText,
          queryScope: query.queryScope,
          scopeCanonicalSubreddit: query.scopeCanonicalSubreddit,
          overlayId: overlayIds.has(overlayId) ? overlayId : undefined,
          hasOverlay: overlayIds.has(overlayId),
          matchedDriverCount: matchedDriverCountByQuery.get(query.normalizedQueryText) ?? 0,
        };
      }),
    },
    panels: [
      { id: "drivers", title: "Driver Posts", kind: "driver_posts", defaultOpen: true },
      { id: "keyword_heat", title: "Keyword Heat", kind: "keyword_table", defaultOpen: true },
      { id: "reliability", title: "Reliability", kind: "provider_reliability", defaultOpen: true },
    ],
    annotations: anomalies.map((anomaly) => ({
      id: `anomaly:${anomaly.eventId}`,
      at: anomaly.observedAt,
      label: `${anomaly.signalType}: ${anomaly.signalKey}`,
      kind: "anomaly",
      severity: anomaly.severity,
      score: anomaly.anomalyScore,
      sourceId: anomaly.eventId,
    })),
    drivers,
    anomalies,
    keywordHeat: dailyInsights.keywordHeat,
    reliability: summarizeReliability(args.providerHealthWindows),
    dataQuality: {
      status:
        materializedFactDays.size === 0
          ? "empty"
          : materializedFactDays.size < dailyInsights.dayCount
            ? "partial"
            : "complete",
      pointCount: materializedFactDays.size,
      expectedPointCount: dailyInsights.dayCount,
      stale: latestPointAt
        ? Date.parse(args.toIso) - Date.parse(`${latestPointAt}T00:00:00.000Z`) > 36 * 60 * 60 * 1000
        : true,
      ...(latestPointAt ? { latestPointAt } : {}),
      generatedAtIso: args.generatedAtIso,
      notes: buildDataQualityNotes({
        pointCount: materializedFactDays.size,
        expectedPointCount: dailyInsights.dayCount,
        latestPointAt,
        toIso: args.toIso,
      }),
    },
  };
}

function buildDataQualityNotes(args: {
  pointCount: number;
  expectedPointCount: number;
  latestPointAt?: string;
  toIso: string;
}): string[] {
  const notes: string[] = [];
  if (args.pointCount === 0) {
    notes.push("No materialized daily facts were found for the selected range.");
  } else if (args.pointCount < args.expectedPointCount) {
    notes.push("The selected range has gaps in materialized daily facts.");
  }
  if (
    !args.latestPointAt ||
    Date.parse(args.toIso) - Date.parse(`${args.latestPointAt}T00:00:00.000Z`) >
      36 * 60 * 60 * 1000
  ) {
    notes.push("Latest materialized point is older than the selected range end.");
  }
  return notes;
}

function valueForSeries(
  id: WorkbenchSeriesId,
  point: ReturnType<typeof buildSubredditDailyInsights>["daily"][number],
): number {
  if (id === "heat_price") {
    return point.heatPrice;
  }
  if (id === "ema_7") {
    return point.ema7;
  }
  if (id === "ema_30") {
    return point.ema30;
  }
  if (id === "total_new_posts") {
    return point.totalNewPosts;
  }
  return point.qualifiedPostVolume;
}

function summarizeReliability(
  windows: ProviderHealthWindow[],
): TargetWorkbenchResponse["reliability"] {
  if (windows.length === 0) {
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

  const sorted = [...windows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const latest = sorted[0]!;
  const totals = windows.reduce(
    (acc, item) => {
      acc.requestCount += item.requestCount;
      acc.successCount += item.successCount;
      acc.errorCount += item.errorCount;
      acc.timeoutCount += item.timeoutCount;
      acc.circuitOpenCount += item.circuitOpenCount;
      acc.duplicatePostCount += item.duplicatePostCount;
      acc.acceptedCount += item.acceptedCount;
      acc.ingestLagSecondsSum += item.ingestLagSecondsSum;
      acc.ingestLagSampleCount += item.ingestLagSampleCount;
      return acc;
    },
    {
      requestCount: 0,
      successCount: 0,
      errorCount: 0,
      timeoutCount: 0,
      circuitOpenCount: 0,
      duplicatePostCount: 0,
      acceptedCount: 0,
      ingestLagSecondsSum: 0,
      ingestLagSampleCount: 0,
    },
  );

  return {
    provider: latest.provider,
    mode: latest.mode,
    requestCount: totals.requestCount,
    successCount: totals.successCount,
    errorCount: totals.errorCount,
    timeoutCount: totals.timeoutCount,
    circuitOpenCount: totals.circuitOpenCount,
    duplicatePostRate:
      totals.acceptedCount > 0 ? totals.duplicatePostCount / totals.acceptedCount : null,
    ingestLagSecondsAvg:
      totals.ingestLagSampleCount > 0
        ? totals.ingestLagSecondsSum / totals.ingestLagSampleCount
        : null,
    lastStatusCode: latest.lastStatusCode,
    lastErrorCode: latest.lastErrorCode,
    lastErrorMessage: latest.lastErrorMessage,
    updatedAt: latest.updatedAt,
  };
}
