import type { SubredditTrendPoint } from "../domain/entities/subreddit-trend-point";
import type { MetricsSnapshotRepository } from "../domain/repositories/metrics-snapshot-repository";
import type { SubredditTrendPointRepository } from "../domain/repositories/subreddit-trend-point-repository";
import { scoreTrendWindows } from "../domain/services/trend-scoring.service";
import { floorToWindow } from "../shared/time/windowing";

export interface BuildSubredditTrendPointsDependencies {
  metricsSnapshotRepository: MetricsSnapshotRepository;
  subredditTrendPointRepository: SubredditTrendPointRepository;
}

export interface BuildSubredditTrendPointsInput {
  targetId: string;
  fromIso: string;
  toIso: string;
}

const HIGH_SCORE_POST_THRESHOLD = 50;
const COMMENT_WEIGHT_FOR_DISPERSION = 0.5;
const IMPACT_COMMENT_WEIGHT = 1.25;
const HIGH_IMPACT_THRESHOLD = 6;
const TREND_WINDOW_MINUTES = 360;
const TREND_GRANULARITY = "6h" as const;

export async function buildSubredditTrendPointsJob(
  deps: BuildSubredditTrendPointsDependencies,
  input: BuildSubredditTrendPointsInput,
): Promise<SubredditTrendPoint[]> {
  const snapshots = await deps.metricsSnapshotRepository.listByTargetInRange({
    targetId: input.targetId,
    from: input.fromIso,
    to: input.toIso,
    metricNames: ["new_posts_15m", "active_users", "subscribers", "score", "num_comments"],
  });

  const byWindow = new Map<
    string,
    {
      newPosts: number;
      activeUsers: number;
      subscribers: number;
      hasNewPosts: boolean;
      hasActiveUsers: boolean;
      hasSubscribers: boolean;
      granularity: "15m" | "1h" | "6h" | "1d";
      postMetrics: Map<string, { score?: number; numComments?: number }>;
    }
  >();

  for (const snapshot of snapshots) {
    const windowStart = floorToWindow(snapshot.snapshotAt, TREND_WINDOW_MINUTES);
    if (!byWindow.has(windowStart)) {
      byWindow.set(windowStart, {
        newPosts: 0,
        activeUsers: 0,
        subscribers: 0,
        hasNewPosts: false,
        hasActiveUsers: false,
        hasSubscribers: false,
        granularity: TREND_GRANULARITY,
        postMetrics: new Map(),
      });
    }
    const current = byWindow.get(windowStart)!;
    if (snapshot.metricName === "new_posts_15m") {
      current.newPosts += Number(snapshot.metricValue);
      current.hasNewPosts = true;
    }
    if (snapshot.metricName === "active_users") {
      current.activeUsers = Number(snapshot.metricValue);
      current.hasActiveUsers = true;
    }
    if (snapshot.metricName === "subscribers") {
      current.subscribers = Number(snapshot.metricValue);
      current.hasSubscribers = true;
    }
    if (snapshot.contentId && snapshot.metricName === "score") {
      const postMetrics = current.postMetrics.get(snapshot.contentId) ?? {};
      postMetrics.score = Number(snapshot.metricValue);
      current.postMetrics.set(snapshot.contentId, postMetrics);
    }
    if (snapshot.contentId && snapshot.metricName === "num_comments") {
      const postMetrics = current.postMetrics.get(snapshot.contentId) ?? {};
      postMetrics.numComments = Number(snapshot.metricValue);
      current.postMetrics.set(snapshot.contentId, postMetrics);
    }
  }

  const windows = Array.from(byWindow.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([windowStart, current]) => {
      const {
        scoreSum,
        commentSum,
        highScorePostCount,
        sampledPostCount,
        activePostRatio,
        dispersionScore,
        impactScoreSum,
        impactPostCount,
        topImpactShare,
      } = aggregatePostMetrics(current.postMetrics);
      const windowStartDate = new Date(windowStart);
      const windowEnd = new Date(
        windowStartDate.getTime() + TREND_WINDOW_MINUTES * 60 * 1000,
      ).toISOString();
      return {
        windowStart,
        windowEnd,
        granularity: current.granularity,
        newPosts: current.newPosts,
        activeUsers: current.activeUsers,
        subscribers: current.subscribers,
        scoreSum,
        commentSum,
        highScorePostCount,
        sampledPostCount,
        activePostRatio,
        dispersionScore,
        impactScoreSum,
        impactPostCount,
        topImpactShare,
        hasNewPosts: current.hasNewPosts,
        hasActiveUsers: current.hasActiveUsers,
        hasSubscribers: current.hasSubscribers,
      };
    });

  const points: SubredditTrendPoint[] = scoreTrendWindows({
    targetId: input.targetId,
    windows,
  });

  if (points.length > 0) {
    await deps.subredditTrendPointRepository.upsertMany(points);
  }

  return points;
}

function aggregatePostMetrics(
  postMetrics: Map<string, { score?: number; numComments?: number }>,
): {
  scoreSum: number;
  commentSum: number;
  highScorePostCount: number;
  sampledPostCount: number;
  activePostRatio: number;
  dispersionScore: number;
  impactScoreSum: number;
  impactPostCount: number;
  topImpactShare: number;
} {
  let scoreSum = 0;
  let commentSum = 0;
  let highScorePostCount = 0;
  let sampledPostCount = 0;
  let activePostCount = 0;
  const contributions: number[] = [];
  const impactContributions: number[] = [];
  let impactScoreSum = 0;
  let impactPostCount = 0;

  for (const value of postMetrics.values()) {
    const score = Number.isFinite(value.score) ? Math.max(0, value.score ?? 0) : 0;
    const numComments = Number.isFinite(value.numComments)
      ? Math.max(0, value.numComments ?? 0)
      : 0;
    const sampled = value.score != null || value.numComments != null;

    if (!sampled) {
      continue;
    }
    sampledPostCount += 1;
    scoreSum += score;
    commentSum += numComments;
    if (score >= HIGH_SCORE_POST_THRESHOLD) {
      highScorePostCount += 1;
    }
    if (score > 0 || numComments > 0) {
      activePostCount += 1;
    }

    contributions.push(score + COMMENT_WEIGHT_FOR_DISPERSION * numComments);
    const impactContribution = log1p(score) + IMPACT_COMMENT_WEIGHT * log1p(numComments);
    impactContributions.push(impactContribution);
    impactScoreSum += impactContribution;
    if (impactContribution >= HIGH_IMPACT_THRESHOLD) {
      impactPostCount += 1;
    }
  }

  const activePostRatio = sampledPostCount > 0 ? activePostCount / sampledPostCount : 0;
  const topImpactShare = computeTopShare(impactContributions, 3);

  return {
    scoreSum: Math.round(scoreSum),
    commentSum: Math.round(commentSum),
    highScorePostCount,
    sampledPostCount,
    activePostRatio: Number(activePostRatio.toFixed(6)),
    dispersionScore: Number(computeDispersionScore(contributions).toFixed(6)),
    impactScoreSum: Number(impactScoreSum.toFixed(6)),
    impactPostCount,
    topImpactShare: Number(topImpactShare.toFixed(6)),
  };
}

function computeDispersionScore(contributions: number[]): number {
  const nonNegative = contributions.map((value) => Math.max(0, value));
  const total = nonNegative.reduce((sum, value) => sum + value, 0);
  if (total <= 0 || nonNegative.length <= 1) {
    return 0;
  }

  let concentration = 0;
  for (const value of nonNegative) {
    const share = value / total;
    concentration += share * share;
  }

  const count = nonNegative.length;
  const normalizedDiversity = (1 - concentration) / (1 - 1 / count);
  return Math.min(1, Math.max(0, normalizedDiversity));
}

function computeTopShare(values: number[], topN: number): number {
  if (values.length === 0) {
    return 0;
  }
  const nonNegative = values.map((value) => Math.max(0, value));
  const total = nonNegative.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    return 0;
  }
  const topSum = [...nonNegative]
    .sort((a, b) => b - a)
    .slice(0, topN)
    .reduce((sum, value) => sum + value, 0);
  return Math.min(1, Math.max(0, topSum / total));
}

function log1p(value: number): number {
  return Math.log(1 + Math.max(0, value));
}
