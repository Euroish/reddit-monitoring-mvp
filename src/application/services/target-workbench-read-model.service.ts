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
}> = [
  { id: "heat_price", label: "Heat Price", family: "trend", unit: "score" },
  { id: "ema_7", label: "EMA 7", family: "trend", unit: "score" },
  { id: "ema_30", label: "EMA 30", family: "trend", unit: "score" },
  { id: "total_new_posts", label: "Total New Posts", family: "activity", unit: "count" },
  { id: "qualified_post_count", label: "Qualified Posts", family: "activity", unit: "count" },
];

export function buildTargetWorkbenchReadModel(args: {
  requestId: string;
  generatedAtIso: string;
  target: MonitorTarget;
  fromIso: string;
  toIso: string;
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
    },
    series: SERIES_DEFS.map((definition) => ({
      ...definition,
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
      { id: "drivers", title: "Driver Posts", kind: "driver_posts" },
      { id: "keyword_heat", title: "Keyword Heat", kind: "keyword_table" },
      { id: "reliability", title: "Reliability", kind: "provider_reliability" },
    ],
    drivers,
    anomalies,
    keywordHeat: dailyInsights.keywordHeat,
    reliability: summarizeReliability(args.providerHealthWindows),
  };
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
