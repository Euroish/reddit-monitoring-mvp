import type { TargetWorkbenchResponse } from "../../../packages/contracts/src/http";
import type { AnomalyEvent } from "../../domain/entities/anomaly-event";
import type { Content } from "../../domain/entities/content";
import type { CrawlCursor } from "../../domain/entities/crawl-cursor";
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
    id: "activity_index",
    label: "Activity Index",
    family: "activity",
    unit: "score",
    defaultVisible: true,
    chartType: "line",
    axis: "primary",
    description:
      "Confidence-weighted relative activity index. 100 is the target's observed baseline; low-sample days are damped toward neutral.",
  },
  {
    id: "qualified_activity_index",
    label: "Qualified Activity Index",
    family: "activity",
    unit: "score",
    defaultVisible: false,
    chartType: "line",
    axis: "primary",
    description:
      "Confidence-weighted relative index for quality-qualified observed posts.",
  },
  {
    id: "activity_confidence",
    label: "Activity Confidence",
    family: "activity",
    unit: "score",
    defaultVisible: false,
    chartType: "bar",
    axis: "secondary",
    description:
      "0-100 confidence score derived from observed sample density and engagement sample coverage.",
  },
  {
    id: "total_new_posts",
    label: "Observed New Posts",
    family: "activity",
    unit: "count",
    defaultVisible: false,
    chartType: "bar",
    axis: "secondary",
    description: "Accepted posts observed by the bounded collector, not total subreddit volume.",
  },
  {
    id: "qualified_post_count",
    label: "Qualified Observed Posts",
    family: "activity",
    unit: "count",
    defaultVisible: false,
    chartType: "bar",
    axis: "secondary",
    description: "Observed posts that passed the configured quality threshold for the day.",
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
  backfillCursor?: CrawlCursor | null;
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
  const coverage = summarizeObservedCoverage({
    facts: args.dailyFacts,
    expectedPointCount: dailyInsights.dayCount,
  });
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
        quality: point.pointQuality,
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
      status: coverage.status,
      pointCount: materializedFactDays.size,
      expectedPointCount: dailyInsights.dayCount,
      backfill: summarizeBackfillCoverage(args.backfillCursor),
      coverage,
      stale: latestPointAt
        ? Date.parse(args.toIso) - Date.parse(`${latestPointAt}T00:00:00.000Z`) > 36 * 60 * 60 * 1000
        : true,
      ...(latestPointAt ? { latestPointAt } : {}),
      generatedAtIso: args.generatedAtIso,
      notes: buildDataQualityNotes({
        pointCount: materializedFactDays.size,
        expectedPointCount: dailyInsights.dayCount,
        coverage,
        latestPointAt,
        toIso: args.toIso,
      }),
    },
  };
}

function summarizeBackfillCoverage(
  backfillCursor?: CrawlCursor | null,
): TargetWorkbenchResponse["dataQuality"]["backfill"] {
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

function buildDataQualityNotes(args: {
  pointCount: number;
  expectedPointCount: number;
  coverage: ReturnType<typeof summarizeObservedCoverage>;
  latestPointAt?: string;
  toIso: string;
}): string[] {
  const notes: string[] = [];
  if (args.pointCount === 0) {
    notes.push("No materialized daily facts were found for the selected range.");
  } else if (args.pointCount < args.expectedPointCount) {
    notes.push("The selected range has gaps in materialized daily facts.");
  }
  if (args.coverage.degradedReasons.includes("observed_post_days_missing")) {
    notes.push(
      "Some materialized days have no observed posts; Reddit listing depth may be source-limited for this target.",
    );
  }
  if (args.coverage.degradedReasons.includes("sampled_post_days_missing")) {
    notes.push("Some observed days have no sampled engagement metrics.");
  }
  if (args.coverage.degradedReasons.includes("low_observed_post_density")) {
    notes.push(
      `Observed activity is too sparse for a reliable volume trend: ${args.coverage.lowObservedPostDayCount} day(s) are below ${args.coverage.minObservedPostsPerDay} observed posts.`,
    );
  }
  if (args.coverage.degradedReasons.includes("front_loaded_backfill_sample")) {
    notes.push(
      "Observed posts are concentrated near the start of the range; the remaining days should be treated as source-limited samples, not actual subreddit volume.",
    );
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

function summarizeObservedCoverage(args: {
  facts: SubredditDailyFact[];
  expectedPointCount: number;
}): TargetWorkbenchResponse["dataQuality"]["coverage"] {
  const materializedDayCount = args.facts.length;
  const observedPostDayCount = args.facts.filter((fact) => fact.postVolume > 0).length;
  const sampledPostDayCount = args.facts.filter((fact) => fact.sampledPostVolume > 0).length;
  const minObservedPostsPerDay = resolveMinObservedPostsPerDay(args.facts);
  const lowObservedPostDayCount = args.facts.filter(
    (fact) => fact.postVolume > 0 && fact.postVolume < minObservedPostsPerDay,
  ).length;
  const observedPostCounts = args.facts.map((fact) => Math.max(0, fact.postVolume));
  const observedPostTotal = observedPostCounts.reduce((sum, count) => sum + count, 0);
  const observedPostMedian = median(observedPostCounts);
  const firstThirdObservedPostShare = computeFirstThirdShare(observedPostCounts);
  const zeroPostFactDayCount = Math.max(0, materializedDayCount - observedPostDayCount);
  const zeroSampleFactDayCount = Math.max(0, materializedDayCount - sampledPostDayCount);
  const degradedReasons: string[] = [];

  if (materializedDayCount < args.expectedPointCount) {
    degradedReasons.push("materialized_fact_days_missing");
  }
  if (materializedDayCount > 0 && observedPostDayCount < materializedDayCount) {
    degradedReasons.push("observed_post_days_missing");
  }
  if (observedPostDayCount > 0 && sampledPostDayCount < observedPostDayCount) {
    degradedReasons.push("sampled_post_days_missing");
  }
  if (observedPostDayCount >= 3 && lowObservedPostDayCount > 0) {
    degradedReasons.push("low_observed_post_density");
  }
  if (
    materializedDayCount >= 7 &&
    observedPostTotal > 0 &&
    firstThirdObservedPostShare >= 0.7
  ) {
    degradedReasons.push("front_loaded_backfill_sample");
  }

  const status =
    materializedDayCount === 0 || observedPostDayCount === 0
      ? "empty"
      : degradedReasons.length > 0
        ? "partial"
        : "complete";

  return {
    scope: "materialized_observed_days",
    status,
    expectedDayCount: args.expectedPointCount,
    materializedDayCount,
    observedPostDayCount,
    sampledPostDayCount,
    lowObservedPostDayCount,
    minObservedPostsPerDay,
    observedPostTotal,
    observedPostMedian,
    firstThirdObservedPostShare,
    zeroPostFactDayCount,
    zeroSampleFactDayCount,
    degradedReasons,
  };
}

function resolveMinObservedPostsPerDay(facts: SubredditDailyFact[]): number {
  const tierRank = {
    micro: 0,
    small: 1,
    mid: 2,
    large: 3,
  } satisfies Record<SubredditDailyFact["subredditTier"], number>;
  const highestTier = facts.reduce<SubredditDailyFact["subredditTier"]>(
    (current, fact) =>
      tierRank[fact.subredditTier] > tierRank[current] ? fact.subredditTier : current,
    "micro",
  );
  if (highestTier === "large") {
    return 10;
  }
  if (highestTier === "mid") {
    return 5;
  }
  return 2;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function computeFirstThirdShare(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return 0;
  }
  const firstThirdCount = Math.max(1, Math.ceil(values.length / 3));
  const firstThirdTotal = values
    .slice(0, firstThirdCount)
    .reduce((sum, value) => sum + value, 0);
  return firstThirdTotal / total;
}

function valueForSeries(
  id: WorkbenchSeriesId,
  point: ReturnType<typeof buildSubredditDailyInsights>["daily"][number],
): number | null {
  if (point.pointQuality === "missing") {
    return null;
  }
  if (id === "heat_price") {
    return point.heatPrice;
  }
  if (id === "ema_7") {
    return point.ema7;
  }
  if (id === "ema_30") {
    return point.ema30;
  }
  if (id === "activity_index") {
    return point.activityIndex;
  }
  if (id === "qualified_activity_index") {
    return point.qualifiedActivityIndex;
  }
  if (id === "activity_confidence") {
    return Number((point.activityConfidence * 100).toFixed(6));
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
