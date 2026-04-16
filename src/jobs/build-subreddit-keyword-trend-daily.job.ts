import {
  matchesNormalizedQueryV2,
  normalizeQueryV2,
  type NormalizedQueryV2,
} from "../application/services/query-normalization-v2.service";
import type { KeywordTrendDaily } from "../domain/entities/keyword-trend-daily";
import type { ContentRepository } from "../domain/repositories/content-repository";
import type { KeywordTrendDailyRepository } from "../domain/repositories/keyword-trend-daily-repository";
import type { MetricsSnapshotRepository } from "../domain/repositories/metrics-snapshot-repository";
import type { SubredditDailyFactRepository } from "../domain/repositories/subreddit-daily-fact-repository";

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

const KEYWORD_TREND_ALGORITHM_VERSION = "keyword_trend_v2_dual_track";

interface KeywordSignal {
  keyword: string;
  track: "auto_keyword" | "explicit_query";
  normalizedQueryText: string;
  queryScope: "subreddit" | "global";
  explainPayload: Record<string, unknown>;
  matchedPosts: number;
  qualifiedMatchedPosts: number;
  matchedScoreSum: number;
  matchedCommentSum: number;
}

interface DayDraft {
  observedPosts: number;
  denominatorPosts: number;
  qualityThresholdScore: number;
  qualityThresholdComments: number;
  byKeyword: Map<string, KeywordSignal>;
}

export interface BuildSubredditKeywordTrendDailyDependencies {
  contentRepository: ContentRepository;
  metricsSnapshotRepository: MetricsSnapshotRepository;
  keywordTrendDailyRepository: KeywordTrendDailyRepository;
  subredditDailyFactRepository?: SubredditDailyFactRepository;
}

export interface BuildSubredditKeywordTrendDailyInput {
  targetId: string;
  canonicalSubreddit?: string;
  explicitQueries?: string[];
  fromIso: string;
  toIso: string;
  qualityMinScore?: number;
  qualityMinComments?: number;
  maxKeywordsPerDay?: number;
  maxExplicitQueriesPerDay?: number;
  sourceType?: "live" | "backfill";
}

export async function buildSubredditKeywordTrendDailyJob(
  deps: BuildSubredditKeywordTrendDailyDependencies,
  input: BuildSubredditKeywordTrendDailyInput,
): Promise<KeywordTrendDaily[]> {
  const qualityMinScore = Math.max(0, input.qualityMinScore ?? 10);
  const qualityMinComments = Math.max(0, input.qualityMinComments ?? 20);
  const maxKeywordsPerDay = Math.max(1, input.maxKeywordsPerDay ?? 50);
  const maxExplicitQueriesPerDay = Math.max(1, input.maxExplicitQueriesPerDay ?? 30);
  const sourceType = input.sourceType ?? "live";
  const fromDay = toUtcDay(input.fromIso);
  const toDay = toUtcDay(input.toIso);
  const explicitQueries = normalizeExplicitQueries({
    queries: input.explicitQueries ?? [],
    canonicalSubreddit: input.canonicalSubreddit,
  });

  const [posts, snapshots, dailyFacts] = await Promise.all([
    deps.contentRepository.findByTargetCreatedAtRange({
      targetId: input.targetId,
      from: input.fromIso,
      to: input.toIso,
      limit: 50000,
    }),
    deps.metricsSnapshotRepository.listByTargetInRange({
      targetId: input.targetId,
      from: input.fromIso,
      to: input.toIso,
      metricNames: ["score", "num_comments"],
    }),
    deps.subredditDailyFactRepository?.listByTargetInRange({
      targetId: input.targetId,
      fromDay,
      toDay,
    }) ?? Promise.resolve([]),
  ]);

  if (posts.length === 0) {
    return [];
  }

  const postMetrics = resolveLatestPostMetricsByContentId(snapshots);
  const dailyFactByDay = new Map(dailyFacts.map((fact) => [fact.day, fact] as const));
  const dayDrafts = new Map<string, DayDraft>();

  for (const post of posts) {
    const day = toUtcDay(post.createdAtSource);
    if (!dayDrafts.has(day)) {
      const dayFact = dailyFactByDay.get(day);
      dayDrafts.set(day, {
        observedPosts: 0,
        denominatorPosts: dayFact?.postVolume ?? 0,
        qualityThresholdScore: dayFact?.qualityThresholdScore ?? qualityMinScore,
        qualityThresholdComments: dayFact?.qualityThresholdComments ?? qualityMinComments,
        byKeyword: new Map(),
      });
    }

    const dayDraft = dayDrafts.get(day)!;
    dayDraft.observedPosts += 1;

    const metrics = postMetrics.get(post.id) ?? { score: 0, comments: 0 };
    const score = Math.max(0, metrics.score);
    const comments = Math.max(0, metrics.comments);
    const qualified =
      score >= dayDraft.qualityThresholdScore &&
      comments >= dayDraft.qualityThresholdComments;

    const text = `${post.title} ${post.bodyText ?? ""}`;
    const keywords = extractAutoTokens(text);
    for (const keyword of keywords) {
      addKeywordSignal({
        dayDraft,
        key: `auto_keyword|subreddit|${keyword}`,
        track: "auto_keyword",
        normalizedQueryText: keyword,
        queryScope: "subreddit",
        keyword,
        explainPayload: {
          extractionMode: "auto_keyword",
          extractionVersion: "auto_keyword_v1",
        },
        score,
        comments,
        qualified,
      });
    }

    for (const query of explicitQueries) {
      if (!matchesNormalizedQueryV2(text, query)) {
        continue;
      }
      addKeywordSignal({
        dayDraft,
        key: `explicit_query|${query.queryScope}|${query.normalizedQueryText}`,
        track: "explicit_query",
        normalizedQueryText: query.normalizedQueryText,
        queryScope: query.queryScope,
        keyword: query.displayQueryText,
        explainPayload: {
          plannerVersion: query.plannerVersion,
          queryScope: query.queryScope,
          scopeCanonicalSubreddit: query.scopeCanonicalSubreddit,
          groupCount: query.groups.length,
          groups: query.groups.map((group) => ({
            type: group.type,
            canonicalTerm: group.canonicalTerm,
            variants: group.variants,
          })),
        },
        score,
        comments,
        qualified,
      });
    }
  }

  const rows = buildRows({
    targetId: input.targetId,
    dayDrafts,
    maxKeywordsPerDay,
    maxExplicitQueriesPerDay,
    sourceType,
  });
  if (rows.length > 0) {
    await deps.keywordTrendDailyRepository.upsertMany(rows);
  }
  return rows;
}

function addKeywordSignal(args: {
  dayDraft: DayDraft;
  key: string;
  track: "auto_keyword" | "explicit_query";
  normalizedQueryText: string;
  queryScope: "subreddit" | "global";
  keyword: string;
  explainPayload: Record<string, unknown>;
  score: number;
  comments: number;
  qualified: boolean;
}): void {
  const current = args.dayDraft.byKeyword.get(args.key) ?? {
    keyword: args.keyword,
    track: args.track,
    normalizedQueryText: args.normalizedQueryText,
    queryScope: args.queryScope,
    explainPayload: args.explainPayload,
    matchedPosts: 0,
    qualifiedMatchedPosts: 0,
    matchedScoreSum: 0,
    matchedCommentSum: 0,
  };
  current.matchedPosts += 1;
  current.matchedScoreSum += args.score;
  current.matchedCommentSum += args.comments;
  if (args.qualified) {
    current.qualifiedMatchedPosts += 1;
  }
  args.dayDraft.byKeyword.set(args.key, current);
}

function normalizeExplicitQueries(args: {
  queries: string[];
  canonicalSubreddit?: string;
}): NormalizedQueryV2[] {
  const canonicalSubreddit = normalizeCanonicalSubreddit(args.canonicalSubreddit);
  const result: NormalizedQueryV2[] = [];
  const seen = new Set<string>();

  for (const rawQuery of args.queries) {
    if (!rawQuery || rawQuery.trim().length === 0) {
      continue;
    }
    let normalized: NormalizedQueryV2;
    try {
      normalized = normalizeQueryV2(rawQuery, canonicalSubreddit);
    } catch {
      continue;
    }
    if (normalized.groups.length === 0 || normalized.normalizedQueryText.length < 2) {
      continue;
    }
    if (
      normalized.queryScope === "subreddit" &&
      normalized.scopeCanonicalSubreddit &&
      canonicalSubreddit &&
      normalized.scopeCanonicalSubreddit !== canonicalSubreddit
    ) {
      continue;
    }
    const key = `${normalized.queryScope}|${normalized.normalizedQueryText}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function resolveLatestPostMetricsByContentId(
  snapshots: Awaited<ReturnType<MetricsSnapshotRepository["listByTargetInRange"]>>,
): Map<string, { score: number; comments: number }> {
  const latestMetricByContentAndName = new Map<string, { snapshotAt: string; value: number }>();

  for (const snapshot of snapshots) {
    if (!snapshot.contentId) {
      continue;
    }
    const key = `${snapshot.contentId}|${snapshot.metricName}`;
    const current = latestMetricByContentAndName.get(key);
    if (!current || snapshot.snapshotAt > current.snapshotAt) {
      latestMetricByContentAndName.set(key, {
        snapshotAt: snapshot.snapshotAt,
        value: Number(snapshot.metricValue),
      });
    }
  }

  const result = new Map<string, { score: number; comments: number }>();
  for (const [key, metric] of latestMetricByContentAndName.entries()) {
    const [contentId, metricName] = key.split("|", 2);
    if (!contentId || !metricName) {
      continue;
    }
    const current = result.get(contentId) ?? { score: 0, comments: 0 };
    if (metricName === "score") {
      current.score = metric.value;
    }
    if (metricName === "num_comments") {
      current.comments = metric.value;
    }
    result.set(contentId, current);
  }
  return result;
}

function buildRows(args: {
  targetId: string;
  dayDrafts: Map<string, DayDraft>;
  maxKeywordsPerDay: number;
  maxExplicitQueriesPerDay: number;
  sourceType: "live" | "backfill";
}): KeywordTrendDaily[] {
  const rows: KeywordTrendDaily[] = [];
  const sortedDays = Array.from(args.dayDrafts.keys()).sort((a, b) => a.localeCompare(b));

  for (const day of sortedDays) {
    const draft = args.dayDrafts.get(day)!;
    const sampledPosts = Math.max(draft.observedPosts, draft.denominatorPosts);
    if (sampledPosts <= 0 || draft.byKeyword.size === 0) {
      continue;
    }

    const allSignals = Array.from(draft.byKeyword.values());
    const autoSignals = allSignals
      .filter((signal) => signal.track === "auto_keyword")
      .sort(sortSignal)
      .slice(0, args.maxKeywordsPerDay);
    const explicitSignals = allSignals
      .filter((signal) => signal.track === "explicit_query")
      .sort(sortSignal)
      .slice(0, args.maxExplicitQueriesPerDay);
    const selected = [...autoSignals, ...explicitSignals];
    if (selected.length === 0) {
      continue;
    }

    const maxScore = Math.max(1, ...selected.map((signal) => signal.matchedScoreSum));
    const maxComments = Math.max(1, ...selected.map((signal) => signal.matchedCommentSum));

    for (const signal of selected) {
      const mentionRate = signal.matchedPosts / sampledPosts;
      const qualifiedMentionRate = signal.qualifiedMatchedPosts / sampledPosts;
      const normalizedScore = signal.matchedScoreSum / maxScore;
      const normalizedComments = signal.matchedCommentSum / maxComments;
      const keywordHeat = clamp(
        0.5 * mentionRate + 0.3 * normalizedScore + 0.2 * normalizedComments,
        0,
        1,
      );
      const breakoutScore = clamp(mentionRate * 0.65 + qualifiedMentionRate * 0.35, 0, 1);
      const isBreakout = breakoutScore >= 0.2 || keywordHeat >= 0.65;

      rows.push({
        targetId: args.targetId,
        day,
        keyword: signal.keyword,
        track: signal.track,
        normalizedQueryText: signal.normalizedQueryText,
        queryScope: signal.queryScope,
        sampledPosts,
        matchedPosts: signal.matchedPosts,
        qualifiedMatchedPosts: signal.qualifiedMatchedPosts,
        mentionRate: toFixedNumber(mentionRate),
        qualifiedMentionRate: toFixedNumber(qualifiedMentionRate),
        matchedScoreSum: signal.matchedScoreSum,
        matchedCommentSum: signal.matchedCommentSum,
        keywordHeat: toFixedNumber(keywordHeat),
        algorithmVersion: KEYWORD_TREND_ALGORITHM_VERSION,
        explainPayload: {
          ...signal.explainPayload,
          sampledPosts,
          matchedPosts: signal.matchedPosts,
          qualifiedMatchedPosts: signal.qualifiedMatchedPosts,
          mentionRate: toFixedNumber(mentionRate),
          qualifiedMentionRate: toFixedNumber(qualifiedMentionRate),
          breakoutScore: toFixedNumber(breakoutScore),
          isBreakout,
        },
        sourceType: args.sourceType,
      });
    }
  }
  return rows;
}

function sortSignal(left: KeywordSignal, right: KeywordSignal): number {
  const byMentions = right.matchedPosts - left.matchedPosts;
  if (byMentions !== 0) {
    return byMentions;
  }
  const byQualified = right.qualifiedMatchedPosts - left.qualifiedMatchedPosts;
  if (byQualified !== 0) {
    return byQualified;
  }
  const byScore = right.matchedScoreSum - left.matchedScoreSum;
  if (byScore !== 0) {
    return byScore;
  }
  return left.normalizedQueryText.localeCompare(right.normalizedQueryText);
}

function extractAutoTokens(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) ?? [];
  return Array.from(new Set(matches.filter((token) => !AUTO_KEYWORD_STOP_WORDS.has(token))));
}

function normalizeCanonicalSubreddit(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().replace(/^r\//i, "").toLowerCase();
  return normalized.length > 0 ? `r/${normalized}` : undefined;
}

function toUtcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toFixedNumber(value: number): number {
  return Number(value.toFixed(6));
}
