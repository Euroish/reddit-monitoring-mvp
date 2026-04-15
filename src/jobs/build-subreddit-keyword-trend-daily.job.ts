import type { KeywordTrendDaily } from "../domain/entities/keyword-trend-daily";
import type { ContentRepository } from "../domain/repositories/content-repository";
import type { KeywordTrendDailyRepository } from "../domain/repositories/keyword-trend-daily-repository";
import type { MetricsSnapshotRepository } from "../domain/repositories/metrics-snapshot-repository";

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

interface KeywordSignal {
  matchedPosts: number;
  qualifiedMatchedPosts: number;
  matchedScoreSum: number;
  matchedCommentSum: number;
}

interface DayDraft {
  sampledPosts: number;
  byKeyword: Map<string, KeywordSignal>;
}

export interface BuildSubredditKeywordTrendDailyDependencies {
  contentRepository: ContentRepository;
  metricsSnapshotRepository: MetricsSnapshotRepository;
  keywordTrendDailyRepository: KeywordTrendDailyRepository;
}

export interface BuildSubredditKeywordTrendDailyInput {
  targetId: string;
  fromIso: string;
  toIso: string;
  qualityMinScore?: number;
  qualityMinComments?: number;
  maxKeywordsPerDay?: number;
  sourceType?: "live" | "backfill";
}

export async function buildSubredditKeywordTrendDailyJob(
  deps: BuildSubredditKeywordTrendDailyDependencies,
  input: BuildSubredditKeywordTrendDailyInput,
): Promise<KeywordTrendDaily[]> {
  const qualityMinScore = Math.max(0, input.qualityMinScore ?? 10);
  const qualityMinComments = Math.max(0, input.qualityMinComments ?? 20);
  const maxKeywordsPerDay = Math.max(1, input.maxKeywordsPerDay ?? 50);
  const sourceType = input.sourceType ?? "live";

  const [posts, snapshots] = await Promise.all([
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
  ]);

  if (posts.length === 0) {
    return [];
  }

  const postMetrics = resolveLatestPostMetricsByContentId(snapshots);
  const dayDrafts = new Map<string, DayDraft>();

  for (const post of posts) {
    const day = toUtcDay(post.createdAtSource);
    if (!dayDrafts.has(day)) {
      dayDrafts.set(day, { sampledPosts: 0, byKeyword: new Map() });
    }

    const dayDraft = dayDrafts.get(day)!;
    dayDraft.sampledPosts += 1;

    const metrics = postMetrics.get(post.id) ?? { score: 0, comments: 0 };
    const score = Math.max(0, metrics.score);
    const comments = Math.max(0, metrics.comments);
    const qualified = score >= qualityMinScore && comments >= qualityMinComments;

    const text = `${post.title} ${post.bodyText ?? ""}`;
    const keywords = extractAutoTokens(text);
    for (const keyword of keywords) {
      const current = dayDraft.byKeyword.get(keyword) ?? {
        matchedPosts: 0,
        qualifiedMatchedPosts: 0,
        matchedScoreSum: 0,
        matchedCommentSum: 0,
      };
      current.matchedPosts += 1;
      current.matchedScoreSum += score;
      current.matchedCommentSum += comments;
      if (qualified) {
        current.qualifiedMatchedPosts += 1;
      }
      dayDraft.byKeyword.set(keyword, current);
    }
  }

  const rows = buildRows({
    targetId: input.targetId,
    dayDrafts,
    maxKeywordsPerDay,
    sourceType,
  });
  if (rows.length > 0) {
    await deps.keywordTrendDailyRepository.upsertMany(rows);
  }
  return rows;
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
  sourceType: "live" | "backfill";
}): KeywordTrendDaily[] {
  const rows: KeywordTrendDaily[] = [];
  const sortedDays = Array.from(args.dayDrafts.keys()).sort((a, b) => a.localeCompare(b));

  for (const day of sortedDays) {
    const draft = args.dayDrafts.get(day)!;
    if (draft.sampledPosts <= 0 || draft.byKeyword.size === 0) {
      continue;
    }

    const topKeywords = Array.from(draft.byKeyword.entries())
      .sort((a, b) => {
        const byMentions = b[1].matchedPosts - a[1].matchedPosts;
        if (byMentions !== 0) {
          return byMentions;
        }
        const byScore = b[1].matchedScoreSum - a[1].matchedScoreSum;
        if (byScore !== 0) {
          return byScore;
        }
        return a[0].localeCompare(b[0]);
      })
      .slice(0, args.maxKeywordsPerDay);

    const maxScore = Math.max(1, ...topKeywords.map(([, signal]) => signal.matchedScoreSum));
    const maxComments = Math.max(1, ...topKeywords.map(([, signal]) => signal.matchedCommentSum));

    for (const [keyword, signal] of topKeywords) {
      const mentionRate = signal.matchedPosts / draft.sampledPosts;
      const qualifiedMentionRate = signal.qualifiedMatchedPosts / draft.sampledPosts;
      const normalizedScore = signal.matchedScoreSum / maxScore;
      const normalizedComments = signal.matchedCommentSum / maxComments;
      const keywordHeat = clamp(
        0.5 * mentionRate + 0.3 * normalizedScore + 0.2 * normalizedComments,
        0,
        1,
      );

      rows.push({
        targetId: args.targetId,
        day,
        keyword,
        sampledPosts: draft.sampledPosts,
        matchedPosts: signal.matchedPosts,
        qualifiedMatchedPosts: signal.qualifiedMatchedPosts,
        mentionRate: toFixedNumber(mentionRate),
        qualifiedMentionRate: toFixedNumber(qualifiedMentionRate),
        matchedScoreSum: signal.matchedScoreSum,
        matchedCommentSum: signal.matchedCommentSum,
        keywordHeat: toFixedNumber(keywordHeat),
        sourceType: args.sourceType,
      });
    }
  }
  return rows;
}

function extractAutoTokens(text: string): string[] {
  const matches = text.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) ?? [];
  return Array.from(new Set(matches.filter((token) => !AUTO_KEYWORD_STOP_WORDS.has(token))));
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

