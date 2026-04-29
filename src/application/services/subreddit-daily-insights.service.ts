import type { Content } from "../../domain/entities/content";
import type { KeywordTrendDaily } from "../../domain/entities/keyword-trend-daily";
import type { PostEngagementLatest } from "../../domain/entities/post-engagement";
import type { SubredditDailyFact } from "../../domain/entities/subreddit-daily-fact";
import type { SubredditTrendPoint } from "../../domain/entities/subreddit-trend-point";
import {
  isQualifiedDailyPost,
  resolveDailyQualityThreshold,
} from "../../domain/services/quality-threshold.service";

const AUTO_KEYWORD_STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "are",
  "was",
  "were",
  "have",
  "has",
  "had",
  "you",
  "your",
  "about",
  "into",
  "over",
  "under",
  "out",
  "not",
  "but",
  "can",
  "could",
  "would",
  "should",
  "there",
  "their",
  "they",
  "them",
  "what",
  "when",
  "where",
  "which",
  "while",
  "how",
  "why",
  "who",
  "new",
  "best",
  "more",
  "some",
  "any",
  "all",
  "our",
  "its",
  "it's",
  "just",
  "get",
  "got",
  "use",
  "using",
  "used",
]);

export interface DailyTrendPoint {
  day: string;
  pointQuality: "observed" | "observed_zero" | "missing";
  totalNewPosts: number;
  totalDiscussion: number;
  activityIndex: number;
  qualifiedActivityIndex: number;
  activityConfidence: number;
  postChangePct: number;
  discussionChangePct: number;
  postSpikeScore: number;
  isPostSpike: boolean;
  postVolume: number;
  qualifiedPostVolume: number;
  heatPrice: number;
  heatChangePct: number;
  ema7: number;
  ema30: number;
  subscriberCount: number;
  activeUserCount: number;
  subredditTier: "micro" | "small" | "mid" | "large";
  qualityThresholdScore: number;
  qualityThresholdComments: number;
  algorithmVersion?: string;
  explainPayload?: Record<string, unknown>;
}

export interface KeywordDailyPoint {
  day: string;
  mentions: number;
}

export interface KeywordHeatPoint {
  keyword: string;
  track: "auto_keyword" | "explicit_query";
  queryScope: "subreddit" | "global";
  totalMentions: number;
  latestDayMentions: number;
  previousDayMentions: number;
  dayChangePct: number;
  spikeScore: number;
  isHot: boolean;
  algorithmVersion?: string;
  explainPayload?: Record<string, unknown>;
  source: "materialized_keyword_trend_daily" | "content_fallback";
  daily: KeywordDailyPoint[];
}

export interface SubredditDailyInsightsReadModel {
  fromIso: string;
  toIso: string;
  dayCount: number;
  daily: DailyTrendPoint[];
  keywordHeat: KeywordHeatPoint[];
}

export function buildSubredditDailyInsights(args: {
  dailyFacts?: SubredditDailyFact[];
  points?: SubredditTrendPoint[];
  posts?: Content[];
  capturedContents?: Content[];
  capturedLatestEngagements?: PostEngagementLatest[];
  keywordDailyRows?: KeywordTrendDaily[];
  fromIso: string;
  toIso: string;
  keywords?: string[];
  keywordLimit?: number;
}): SubredditDailyInsightsReadModel {
  const days = enumerateUtcDays(args.fromIso, args.toIso);
  const daily = buildDailyMetrics({
    dailyFacts: args.dailyFacts ?? [],
    points: args.points ?? [],
    capturedContents: args.capturedContents ?? [],
    capturedLatestEngagements: args.capturedLatestEngagements ?? [],
    days,
  });
  const keywordHeat =
    args.keywordDailyRows && args.keywordDailyRows.length > 0
      ? buildKeywordHeatFromDailyRows({
          rows: args.keywordDailyRows,
          days,
          keywords: args.keywords ?? [],
          keywordLimit: args.keywordLimit ?? 10,
        })
      : buildKeywordHeat({
          posts: args.posts ?? [],
          days,
          keywords: args.keywords ?? [],
          keywordLimit: args.keywordLimit ?? 10,
        });

  return {
    fromIso: args.fromIso,
    toIso: args.toIso,
    dayCount: days.length,
    daily,
    keywordHeat,
  };
}

function buildKeywordHeatFromDailyRows(args: {
  rows: KeywordTrendDaily[];
  days: string[];
  keywords: string[];
  keywordLimit: number;
}): KeywordHeatPoint[] {
  if (args.days.length === 0 || args.rows.length === 0) {
    return [];
  }

  const normalizedKeywords = normalizeKeywords(args.keywords);
  const keywordFilter = normalizedKeywords.length > 0 ? new Set(normalizedKeywords) : null;
  const daySet = new Set(args.days);
  const rows = args.rows.filter((row) => {
    if (!daySet.has(row.day)) {
      return false;
    }
    if (
      keywordFilter &&
      !keywordFilter.has(row.keyword) &&
      !keywordFilter.has(row.normalizedQueryText)
    ) {
      return false;
    }
    return true;
  });
  if (rows.length === 0) {
    return [];
  }

  const keywordMap = new Map<
    string,
    {
      keyword: string;
      track: "auto_keyword" | "explicit_query";
      queryScope: "subreddit" | "global";
      algorithmVersion?: string;
      explainPayload?: Record<string, unknown>;
      byDay: Map<string, number>;
    }
  >();
  for (const row of rows) {
    const key = `${row.track}|${row.queryScope}|${row.normalizedQueryText}`;
    if (!keywordMap.has(key)) {
      keywordMap.set(key, {
        keyword: row.keyword,
        track: row.track,
        queryScope: row.queryScope,
        algorithmVersion: row.algorithmVersion,
        explainPayload: row.explainPayload,
        byDay: new Map(),
      });
    }
    keywordMap.get(key)!.byDay.set(row.day, row.matchedPosts);
  }

  const heatPoints: KeywordHeatPoint[] = [];
  for (const entry of keywordMap.values()) {
    const daily = args.days.map((day) => ({
      day,
      mentions: entry.byDay.get(day) ?? 0,
    }));
    const totalMentions = daily.reduce((sum, point) => sum + point.mentions, 0);
    const latestDayMentions = daily[daily.length - 1]?.mentions ?? 0;
    const previousDayMentions = daily[daily.length - 2]?.mentions ?? 0;
    const dayChangePct = safePctChange(latestDayMentions, previousDayMentions);
    const history = daily.slice(0, -1).map((point) => point.mentions);
    const spikeScore = toFixedNumber(Math.max(0, robustZScore(latestDayMentions, history)));

    heatPoints.push({
      keyword: entry.keyword,
      track: entry.track,
      queryScope: entry.queryScope,
      totalMentions,
      latestDayMentions,
      previousDayMentions,
      dayChangePct: toFixedNumber(dayChangePct),
      spikeScore,
      isHot: spikeScore >= 2 || dayChangePct >= 1,
      algorithmVersion: entry.algorithmVersion,
      explainPayload: entry.explainPayload,
      source: "materialized_keyword_trend_daily",
      daily,
    });
  }

  return heatPoints
    .sort((a, b) => {
      if (b.totalMentions !== a.totalMentions) {
        return b.totalMentions - a.totalMentions;
      }
      return b.dayChangePct - a.dayChangePct;
    })
    .slice(0, args.keywordLimit);
}

function buildDailyMetrics(args: {
  dailyFacts: SubredditDailyFact[];
  points: SubredditTrendPoint[];
  capturedContents: Content[];
  capturedLatestEngagements: PostEngagementLatest[];
  days: string[];
}): DailyTrendPoint[] {
  const factByDay = new Map(args.dailyFacts.map((fact) => [fact.day, fact]));
  const byDay = new Map<
    string,
    {
      totalNewPosts: number;
      totalDiscussion: number;
    }
  >();
  for (const day of args.days) {
    byDay.set(day, { totalNewPosts: 0, totalDiscussion: 0 });
  }

  for (const point of args.points) {
    const day = toUtcDay(point.windowStart);
    const current = byDay.get(day);
    if (!current) {
      continue;
    }
    current.totalNewPosts += Math.max(0, point.newPosts);
    current.totalDiscussion += Math.max(0, point.commentSum ?? 0);
  }

  const history: number[] = [];
  const result: DailyTrendPoint[] = [];
  let previous: { totalNewPosts: number; totalDiscussion: number } | null = null;
  const factSeries = args.days.map((day) => factByDay.get(day));
  const capturedByDay = buildCapturedMetricsByDay({
    capturedContents: args.capturedContents,
    capturedLatestEngagements: args.capturedLatestEngagements,
    days: args.days,
    factByDay,
  });
  const observedPostBaseline = medianPositive(
    factSeries.map((fact, index) => {
      const day = args.days[index]!;
      return capturedByDay.get(day)?.postVolume ?? resolveDisplayedPostVolume({
        factPostVolume: fact?.postVolume,
        fallbackTotalNewPosts: byDay.get(day)!.totalNewPosts,
      });
    }),
  );
  const qualifiedPostBaseline = medianPositive(
    factSeries.map((fact) => fact?.qualifiedPostVolume ?? 0),
  );

  for (const day of args.days) {
    const fallback = byDay.get(day)!;
    const fact = factByDay.get(day);
    const captured = capturedByDay.get(day);
    const totalNewPosts = captured?.postVolume ?? resolveDisplayedPostVolume({
      factPostVolume: fact?.postVolume,
      fallbackTotalNewPosts: fallback.totalNewPosts,
    });
    const totalDiscussion = fact?.commentSum ?? fallback.totalDiscussion;
    const minObservedPostsPerDay = fact ? minObservedPostsForTier(fact.subredditTier) : 2;
    const sampleReliability =
      captured && totalNewPosts > 0
        ? 1
        : fact && totalNewPosts > 0
          ? clamp(fact.sampledPostVolume / totalNewPosts, 0, 1)
          : 0;
    const activityConfidence =
      totalNewPosts > 0
        ? toFixedNumber(
            Math.sqrt(clamp(totalNewPosts / minObservedPostsPerDay, 0, 1)) *
              (fact ? sampleReliability : 0.5),
          )
        : 0;
    const activityIndex = confidenceWeightedIndex({
      observedValue: totalNewPosts,
      baseline: observedPostBaseline,
      confidence: activityConfidence,
    });
    const qualifiedActivityIndex = confidenceWeightedIndex({
      observedValue: fact?.qualifiedPostVolume ?? 0,
      baseline: qualifiedPostBaseline,
      confidence: activityConfidence,
    });
    const postChangePct = previous
      ? safePctChange(totalNewPosts, previous.totalNewPosts)
      : 0;
    const discussionChangePct = previous
      ? safePctChange(totalDiscussion, previous.totalDiscussion)
      : 0;
    const postSpikeScore = toFixedNumber(Math.max(0, robustZScore(totalNewPosts, history)));
    const isPostSpike = postSpikeScore >= 2 || postChangePct >= 1;

    result.push({
      day,
      pointQuality: !fact ? "missing" : fact.postVolume > 0 ? "observed" : "observed_zero",
      totalNewPosts,
      totalDiscussion,
      activityIndex,
      qualifiedActivityIndex,
      activityConfidence,
      postChangePct: toFixedNumber(postChangePct),
      discussionChangePct: toFixedNumber(discussionChangePct),
      postSpikeScore,
      isPostSpike,
      postVolume: totalNewPosts,
      qualifiedPostVolume: captured?.qualifiedPostVolume ?? fact?.qualifiedPostVolume ?? 0,
      heatPrice: fact?.heatPrice ?? 0,
      heatChangePct: fact?.heatChangePct ?? 0,
      ema7: fact?.ema7 ?? 0,
      ema30: fact?.ema30 ?? 0,
      subscriberCount: fact?.subscriberCount ?? 0,
      activeUserCount: fact?.activeUserCount ?? 0,
      subredditTier: fact?.subredditTier ?? "micro",
      qualityThresholdScore: fact?.qualityThresholdScore ?? 0,
      qualityThresholdComments: fact?.qualityThresholdComments ?? 0,
      algorithmVersion: fact?.algorithmVersion,
      explainPayload: {
        ...(fact?.explainPayload ?? {}),
        ...(captured
          ? {
              capturedPostVolume: captured.postVolume,
              capturedQualifiedPostVolume: captured.qualifiedPostVolume,
            }
          : {}),
        observedPostBaseline,
        qualifiedPostBaseline,
        activityConfidence,
        minObservedPostsPerDay,
      },
    });

    history.push(totalNewPosts);
    previous = {
      totalNewPosts,
      totalDiscussion,
    };
  }

  return result;
}

function buildCapturedMetricsByDay(args: {
  capturedContents: Content[];
  capturedLatestEngagements: PostEngagementLatest[];
  days: string[];
  factByDay: ReadonlyMap<string, SubredditDailyFact>;
}): Map<string, { postVolume: number; qualifiedPostVolume: number }> {
  const daySet = new Set(args.days);
  const latestTier = args.factByDay.values().next().value?.subredditTier ?? "small";
  const engagementByContentId = new Map(
    args.capturedLatestEngagements.map((row) => [row.contentId, row] as const),
  );
  const result = new Map<string, { postVolume: number; qualifiedPostVolume: number }>();

  for (const content of args.capturedContents) {
    const day = toUtcDay(content.firstSeenAt);
    if (!daySet.has(day) || !(content.totalEligible ?? true)) {
      continue;
    }
    const current = result.get(day) ?? { postVolume: 0, qualifiedPostVolume: 0 };
    current.postVolume += 1;
    const fact = args.factByDay.get(day);
    const threshold = fact
      ? { score: fact.qualityThresholdScore, comments: fact.qualityThresholdComments }
      : resolveDailyQualityThreshold({ tier: latestTier, posts: [] });
    const engagement = engagementByContentId.get(content.id);
    if (
      engagement &&
      isQualifiedDailyPost({
        score: engagement.score ?? 0,
        comments: engagement.numComments ?? 0,
        threshold,
      })
    ) {
      current.qualifiedPostVolume += 1;
    }
    result.set(day, current);
  }

  return result;
}

function resolveDisplayedPostVolume(args: {
  factPostVolume: number | undefined;
  fallbackTotalNewPosts: number;
}): number {
  if (args.fallbackTotalNewPosts > 0) {
    return Math.max(0, args.fallbackTotalNewPosts);
  }
  return Math.max(0, args.factPostVolume ?? 0);
}

function confidenceWeightedIndex(args: {
  observedValue: number;
  baseline: number;
  confidence: number;
}): number {
  if (args.baseline <= 0 || args.observedValue <= 0) {
    return args.confidence > 0 ? toFixedNumber(100 * (1 - args.confidence)) : 0;
  }
  const rawIndex = clamp((args.observedValue / args.baseline) * 100, 0, 300);
  return toFixedNumber(100 + (rawIndex - 100) * clamp(args.confidence, 0, 1));
}

function medianPositive(values: number[]): number {
  const positive = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (positive.length === 0) {
    return 0;
  }
  const mid = Math.floor(positive.length / 2);
  if (positive.length % 2 === 1) {
    return positive[mid] ?? 0;
  }
  return ((positive[mid - 1] ?? 0) + (positive[mid] ?? 0)) / 2;
}

function minObservedPostsForTier(tier: SubredditDailyFact["subredditTier"]): number {
  if (tier === "large") {
    return 10;
  }
  if (tier === "mid") {
    return 5;
  }
  return 2;
}

function buildKeywordHeat(args: {
  posts: Content[];
  days: string[];
  keywords: string[];
  keywordLimit: number;
}): KeywordHeatPoint[] {
  if (args.days.length === 0) {
    return [];
  }
  const normalizedKeywords = normalizeKeywords(args.keywords);
  const keywordSet = new Set(normalizedKeywords);
  const autoCounts = new Map<string, number>();
  const dayKeywordCounts = new Map<string, Map<string, number>>();

  for (const post of args.posts) {
    const day = toUtcDay(post.createdAtSource);
    if (!args.days.includes(day)) {
      continue;
    }
    if (!dayKeywordCounts.has(day)) {
      dayKeywordCounts.set(day, new Map());
    }
    const text = `${post.title} ${post.bodyText ?? ""}`;

    if (normalizedKeywords.length > 0) {
      for (const keyword of normalizedKeywords) {
        if (containsKeyword(text, keyword)) {
          incrementMap(dayKeywordCounts.get(day)!, keyword, 1);
        }
      }
      continue;
    }

    const tokens = extractAutoTokens(text);
    for (const token of tokens) {
      if (AUTO_KEYWORD_STOP_WORDS.has(token)) {
        continue;
      }
      incrementMap(autoCounts, token, 1);
      incrementMap(dayKeywordCounts.get(day)!, token, 1);
    }
  }

  const keywords =
    normalizedKeywords.length > 0
      ? normalizedKeywords
      : Array.from(autoCounts.entries())
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, args.keywordLimit)
          .map(([keyword]) => keyword);

  const heatPoints: KeywordHeatPoint[] = [];
  for (const keyword of keywords) {
    const daily = args.days.map((day) => ({
      day,
      mentions: dayKeywordCounts.get(day)?.get(keyword) ?? 0,
    }));
    const totalMentions = daily.reduce((sum, point) => sum + point.mentions, 0);
    const latestDayMentions = daily[daily.length - 1]?.mentions ?? 0;
    const previousDayMentions = daily[daily.length - 2]?.mentions ?? 0;
    const dayChangePct = safePctChange(latestDayMentions, previousDayMentions);
    const history = daily.slice(0, -1).map((point) => point.mentions);
    const spikeScore = toFixedNumber(Math.max(0, robustZScore(latestDayMentions, history)));

    heatPoints.push({
      keyword,
      track: "auto_keyword",
      queryScope: "subreddit",
      totalMentions,
      latestDayMentions,
      previousDayMentions,
      dayChangePct: toFixedNumber(dayChangePct),
      spikeScore,
      isHot: spikeScore >= 2 || dayChangePct >= 1,
      source: "content_fallback",
      daily,
    });
  }

  return heatPoints
    .sort((a, b) => {
      if (b.totalMentions !== a.totalMentions) {
        return b.totalMentions - a.totalMentions;
      }
      return b.dayChangePct - a.dayChangePct;
    })
    .slice(0, args.keywordLimit);
}

function normalizeKeywords(keywords: string[]): string[] {
  return Array.from(
    new Set(
      keywords
        .map((keyword) => keyword.trim().toLowerCase())
        .filter((keyword) => keyword.length >= 2),
    ),
  );
}

function enumerateUtcDays(fromIso: string, toIso: string): string[] {
  const startDate = new Date(`${toUtcDay(fromIso)}T00:00:00.000Z`);
  const endDate = new Date(`${toUtcDay(toIso)}T00:00:00.000Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return [];
  }
  if (startDate.getTime() > endDate.getTime()) {
    return [];
  }

  const days: string[] = [];
  const cursor = new Date(startDate.getTime());
  while (cursor.getTime() <= endDate.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function extractAutoTokens(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) ?? [];
  return Array.from(new Set(matches));
}

function containsKeyword(text: string, keyword: string): boolean {
  const lowered = text.toLowerCase();
  if (keyword.includes(" ")) {
    return lowered.includes(keyword);
  }
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b${escaped}\\b`, "i");
  return pattern.test(lowered);
}

function incrementMap(map: Map<string, number>, key: string, delta: number): void {
  map.set(key, (map.get(key) ?? 0) + delta);
}

function safePctChange(current: number, previous: number): number {
  if (previous <= 0) {
    return current > 0 ? 1 : 0;
  }
  return (current - previous) / previous;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function robustZScore(current: number, history: number[]): number {
  if (history.length < 3) {
    return 0;
  }
  const medianValue = median(history);
  const deviations = history.map((value) => Math.abs(value - medianValue));
  const mad = median(deviations);
  const epsilon = 1e-9;
  if (mad > epsilon) {
    return (current - medianValue) / (1.4826 * mad);
  }
  const meanValue = mean(history);
  const stdDev = standardDeviation(history, meanValue);
  if (stdDev <= epsilon) {
    return 0;
  }
  return (current - meanValue) / stdDev;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[], precomputedMean?: number): number {
  if (values.length < 2) {
    return 0;
  }
  const mu = precomputedMean ?? mean(values);
  const variance =
    values.reduce((sum, value) => {
      const diff = value - mu;
      return sum + diff * diff;
    }, 0) / values.length;
  return Math.sqrt(variance);
}

function toUtcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function toFixedNumber(value: number): number {
  return Number(value.toFixed(6));
}
