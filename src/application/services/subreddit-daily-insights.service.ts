import type { Content } from "../../domain/entities/content";
import type { KeywordTrendDaily } from "../../domain/entities/keyword-trend-daily";
import type { SubredditTrendPoint } from "../../domain/entities/subreddit-trend-point";

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
  totalNewPosts: number;
  totalDiscussion: number;
  postChangePct: number;
  discussionChangePct: number;
  postSpikeScore: number;
  isPostSpike: boolean;
}

export interface KeywordDailyPoint {
  day: string;
  mentions: number;
}

export interface KeywordHeatPoint {
  keyword: string;
  totalMentions: number;
  latestDayMentions: number;
  previousDayMentions: number;
  dayChangePct: number;
  spikeScore: number;
  isHot: boolean;
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
  points: SubredditTrendPoint[];
  posts?: Content[];
  keywordDailyRows?: KeywordTrendDaily[];
  fromIso: string;
  toIso: string;
  keywords?: string[];
  keywordLimit?: number;
}): SubredditDailyInsightsReadModel {
  const days = enumerateUtcDays(args.fromIso, args.toIso);
  const daily = buildDailyMetrics(args.points, days);
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
    if (keywordFilter && !keywordFilter.has(row.keyword)) {
      return false;
    }
    return true;
  });
  if (rows.length === 0) {
    return [];
  }

  const keywordMap = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!keywordMap.has(row.keyword)) {
      keywordMap.set(row.keyword, new Map());
    }
    keywordMap.get(row.keyword)!.set(row.day, row.matchedPosts);
  }

  const heatPoints: KeywordHeatPoint[] = [];
  for (const [keyword, byDay] of keywordMap.entries()) {
    const daily = args.days.map((day) => ({
      day,
      mentions: byDay.get(day) ?? 0,
    }));
    const totalMentions = daily.reduce((sum, point) => sum + point.mentions, 0);
    const latestDayMentions = daily[daily.length - 1]?.mentions ?? 0;
    const previousDayMentions = daily[daily.length - 2]?.mentions ?? 0;
    const dayChangePct = safePctChange(latestDayMentions, previousDayMentions);
    const history = daily.slice(0, -1).map((point) => point.mentions);
    const spikeScore = toFixedNumber(Math.max(0, robustZScore(latestDayMentions, history)));

    heatPoints.push({
      keyword,
      totalMentions,
      latestDayMentions,
      previousDayMentions,
      dayChangePct: toFixedNumber(dayChangePct),
      spikeScore,
      isHot: spikeScore >= 2 || dayChangePct >= 1,
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

function buildDailyMetrics(points: SubredditTrendPoint[], days: string[]): DailyTrendPoint[] {
  const byDay = new Map<string, { totalNewPosts: number; totalDiscussion: number }>();
  for (const day of days) {
    byDay.set(day, { totalNewPosts: 0, totalDiscussion: 0 });
  }

  for (const point of points) {
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

  for (const day of days) {
    const current = byDay.get(day)!;
    const postChangePct = previous
      ? safePctChange(current.totalNewPosts, previous.totalNewPosts)
      : 0;
    const discussionChangePct = previous
      ? safePctChange(current.totalDiscussion, previous.totalDiscussion)
      : 0;
    const postSpikeScore = toFixedNumber(Math.max(0, robustZScore(current.totalNewPosts, history)));
    const isPostSpike = postSpikeScore >= 2 || postChangePct >= 1;

    result.push({
      day,
      totalNewPosts: current.totalNewPosts,
      totalDiscussion: current.totalDiscussion,
      postChangePct: toFixedNumber(postChangePct),
      discussionChangePct: toFixedNumber(discussionChangePct),
      postSpikeScore,
      isPostSpike,
    });

    history.push(current.totalNewPosts);
    previous = current;
  }

  return result;
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
      totalMentions,
      latestDayMentions,
      previousDayMentions,
      dayChangePct: toFixedNumber(dayChangePct),
      spikeScore,
      isHot: spikeScore >= 2 || dayChangePct >= 1,
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
