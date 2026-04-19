import type { KeywordTrendDaily } from "../../domain/entities/keyword-trend-daily";

export interface GlobalKeywordDailyTrendPoint {
  day: string;
  matchedPosts: number;
  qualifiedMatchedPosts: number;
  sampledPosts: number;
  mentionRate: number;
  qualifiedMentionRate: number;
  keywordHeat: number;
  breakoutScore: number;
  isBreakout: boolean;
  matchedSubredditCount: number;
  sourceTypes: Array<"live" | "backfill">;
  algorithmVersion: string | null;
  explainPayload: Record<string, unknown>;
}

export interface GlobalKeywordDailyTrendReadModel {
  normalizedQueryText: string;
  fromIso: string;
  toIso: string;
  dayCount: number;
  days: GlobalKeywordDailyTrendPoint[];
}

export function buildGlobalKeywordDailyTrendReadModel(args: {
  normalizedQueryText: string;
  rows: KeywordTrendDaily[];
  fromIso: string;
  toIso: string;
}): GlobalKeywordDailyTrendReadModel {
  const days = enumerateUtcDays(args.fromIso, args.toIso);
  const rowsByDay = new Map<string, KeywordTrendDaily[]>();
  for (const row of args.rows) {
    const current = rowsByDay.get(row.day) ?? [];
    current.push(row);
    rowsByDay.set(row.day, current);
  }

  return {
    normalizedQueryText: args.normalizedQueryText,
    fromIso: args.fromIso,
    toIso: args.toIso,
    dayCount: days.length,
    days: days.map((day) => buildDayPoint(day, rowsByDay.get(day) ?? [])),
  };
}

function buildDayPoint(
  day: string,
  rows: KeywordTrendDaily[],
): GlobalKeywordDailyTrendPoint {
  if (rows.length === 0) {
    return {
      day,
      matchedPosts: 0,
      qualifiedMatchedPosts: 0,
      sampledPosts: 0,
      mentionRate: 0,
      qualifiedMentionRate: 0,
      keywordHeat: 0,
      breakoutScore: 0,
      isBreakout: false,
      matchedSubredditCount: 0,
      sourceTypes: [],
      algorithmVersion: null,
      explainPayload: {
        matchedSubredditCount: 0,
      },
    };
  }

  const matchedPosts = sum(rows.map((row) => row.matchedPosts));
  const qualifiedMatchedPosts = sum(rows.map((row) => row.qualifiedMatchedPosts));
  const sampledPosts = sum(rows.map((row) => row.sampledPosts));
  const matchedScoreSum = sum(rows.map((row) => row.matchedScoreSum));
  const matchedCommentSum = sum(rows.map((row) => row.matchedCommentSum));
  const mentionRate = sampledPosts > 0 ? matchedPosts / sampledPosts : 0;
  const qualifiedMentionRate =
    sampledPosts > 0 ? qualifiedMatchedPosts / sampledPosts : 0;
  const matchedSubredditCount = new Set(rows.map((row) => row.targetId)).size;
  const normalizedScore = matchedPosts > 0 ? matchedScoreSum / matchedPosts : 0;
  const normalizedComments = matchedPosts > 0 ? matchedCommentSum / matchedPosts : 0;
  const keywordHeat = clamp(
    0.55 * mentionRate +
      0.25 * clamp(normalizedScore / 100, 0, 1) +
      0.2 * clamp(normalizedComments / 50, 0, 1),
    0,
    1,
  );
  const breakoutScore = clamp(
    0.65 * mentionRate + 0.35 * qualifiedMentionRate,
    0,
    1,
  );
  const sourceTypes = Array.from(
    new Set(rows.map((row) => row.sourceType)),
  ).sort((left, right) => left.localeCompare(right));
  const algorithmVersion = mostCommonValue(
    rows.map((row) => row.algorithmVersion).filter((value) => value.length > 0),
  );

  return {
    day,
    matchedPosts,
    qualifiedMatchedPosts,
    sampledPosts,
    mentionRate: toFixedNumber(mentionRate),
    qualifiedMentionRate: toFixedNumber(qualifiedMentionRate),
    keywordHeat: toFixedNumber(keywordHeat),
    breakoutScore: toFixedNumber(breakoutScore),
    isBreakout: breakoutScore >= 0.2 || keywordHeat >= 0.65,
    matchedSubredditCount,
    sourceTypes,
    algorithmVersion: algorithmVersion ?? null,
    explainPayload: {
      matchedScoreSum,
      matchedCommentSum,
      matchedSubredditCount,
      sourceTypes,
      contributingTargetIds: Array.from(
        new Set(rows.map((row) => row.targetId)),
      ).sort((left, right) => left.localeCompare(right)),
    },
  };
}

function enumerateUtcDays(fromIso: string, toIso: string): string[] {
  const start = new Date(`${toUtcDay(fromIso)}T00:00:00.000Z`);
  const end = new Date(`${toUtcDay(toIso)}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return [];
  }
  if (start.getTime() > end.getTime()) {
    return [];
  }
  const days: string[] = [];
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function toUtcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toFixedNumber(value: number): number {
  return Number(value.toFixed(6));
}

function mostCommonValue(values: string[]): string | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((left, right) => {
    const byCount = right[1] - left[1];
    if (byCount !== 0) {
      return byCount;
    }
    return left[0].localeCompare(right[0]);
  })[0]?.[0];
}
