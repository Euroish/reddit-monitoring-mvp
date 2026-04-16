import type { SubredditTrendPoint, TrendGranularity } from "../entities/subreddit-trend-point";
import type { UUID } from "../../shared/types/common";

export interface TrendWindowInput {
  windowStart: string;
  windowEnd: string;
  granularity: TrendGranularity;
  newPosts: number;
  activeUsers: number;
  subscribers: number;
  scoreSum: number;
  commentSum: number;
  highScorePostCount: number;
  sampledPostCount: number;
  activePostRatio: number;
  dispersionScore: number;
  impactScoreSum?: number;
  impactPostCount?: number;
  topImpactShare?: number;
  hasNewPosts: boolean;
  hasActiveUsers: boolean;
  hasSubscribers: boolean;
}

export interface TrendScoringParams {
  heatWeightNewPosts: number;
  heatWeightScoreSum: number;
  heatWeightCommentSum: number;
  heatWeightActiveUsers: number;
  heatWeightDispersion: number;
  heatWeightImpactScore: number;
  heatWeightImpactBreadth: number;
  heatWeightReliability: number;
  heatConcentrationPenalty: number;
  heatScale: number;
  surgeLookbackWindows: number;
  surgeScale: number;
  surgeZWeight: number;
  surgeHeatChangeWeight: number;
  surgeImpactMomentumWeight: number;
  anomalyZDivisor: number;
  trendWeightHeatChange: number;
  trendWeightSurge: number;
  trendWeightDispersion: number;
  trendWeightImpactMomentum: number;
  trendWeightReliability: number;
}

export const DEFAULT_TREND_SCORING_PARAMS: TrendScoringParams = {
  heatWeightNewPosts: 0.1,
  heatWeightScoreSum: 0.22,
  heatWeightCommentSum: 0.2,
  heatWeightActiveUsers: 0.1,
  heatWeightDispersion: 0.08,
  heatWeightImpactScore: 0.22,
  heatWeightImpactBreadth: 0.08,
  heatWeightReliability: 0.06,
  heatConcentrationPenalty: 0.06,
  heatScale: 8,
  surgeLookbackWindows: 12,
  surgeScale: 2,
  surgeZWeight: 0.6,
  surgeHeatChangeWeight: 0.2,
  surgeImpactMomentumWeight: 0.2,
  anomalyZDivisor: 4,
  trendWeightHeatChange: 0.38,
  trendWeightSurge: 0.22,
  trendWeightDispersion: 0.1,
  trendWeightImpactMomentum: 0.2,
  trendWeightReliability: 0.1,
};

const ALGORITHM_VERSION = "trend_v4_tier_quality_thresholds";

export function scoreTrendWindows(args: {
  targetId: UUID;
  windows: TrendWindowInput[];
  params?: Partial<TrendScoringParams>;
}): SubredditTrendPoint[] {
  if (args.windows.length === 0) {
    return [];
  }

  const params: TrendScoringParams = {
    ...DEFAULT_TREND_SCORING_PARAMS,
    ...args.params,
  };
  const windows = [...args.windows].sort((a, b) => a.windowStart.localeCompare(b.windowStart));
  const points: SubredditTrendPoint[] = [];

  const heatRawSeries: number[] = [];
  let previousVelocity = 0;
  let previousHeatIndex = 0;
  let previousImpactScore = 0;

  for (let index = 0; index < windows.length; index += 1) {
    const current = windows[index];
    const previous = index > 0 ? windows[index - 1] : undefined;
    const impactScore = Math.max(
      0,
      current.impactScoreSum ?? current.scoreSum + 0.75 * current.commentSum,
    );
    const impactPostCount = Math.max(0, current.impactPostCount ?? current.highScorePostCount);
    const impactBreadth =
      current.sampledPostCount > 0 ? impactPostCount / current.sampledPostCount : 0;
    const topImpactShare = clamp(current.topImpactShare ?? 0, 0, 1);
    const sampleReliability = clamp(
      current.sampledPostCount / Math.max(current.newPosts, 1),
      0,
      1,
    );

    const heatRaw =
      params.heatWeightNewPosts * log1p(current.newPosts) +
      params.heatWeightScoreSum * log1p(current.scoreSum) +
      params.heatWeightCommentSum * log1p(current.commentSum) +
      params.heatWeightActiveUsers * log1p(current.activeUsers) +
      params.heatWeightDispersion * current.dispersionScore +
      params.heatWeightImpactScore * log1p(impactScore) +
      params.heatWeightImpactBreadth * impactBreadth +
      params.heatWeightReliability * sampleReliability -
      params.heatConcentrationPenalty * topImpactShare;
    const heatIndex = toFixedNumber(clamp(100 * Math.tanh(Math.max(0, heatRaw) / params.heatScale), 0, 100));
    const heatChangePctRaw = previous ? (heatIndex - previousHeatIndex) / Math.max(previousHeatIndex, 1) : 0;
    const heatChangePct = toFixedNumber(heatChangePctRaw);
    const impactMomentumRaw = previous ? (impactScore - previousImpactScore) / Math.max(previousImpactScore, 1) : 0;
    const impactMomentum = toFixedNumber(clamp(impactMomentumRaw, -1, 1));

    const heatHistory = heatRawSeries.slice(-params.surgeLookbackWindows);
    const heatRobustZ = robustZScore(heatRaw, heatHistory);
    const positiveHeatZ = Math.max(0, heatRobustZ);
    const surgeRaw =
      params.surgeZWeight * positiveHeatZ +
      params.surgeHeatChangeWeight * Math.max(0, heatChangePctRaw) +
      params.surgeImpactMomentumWeight * Math.max(0, impactMomentumRaw);
    const surgeScore = toFixedNumber(clamp(Math.tanh(surgeRaw / params.surgeScale), 0, 1));

    const velocityScore = toFixedNumber(clamp(heatChangePctRaw, -1, 1));
    const accelerationScore = toFixedNumber(clamp(velocityScore - previousVelocity, -1, 1));
    const baselineDeviationScore = toFixedNumber(clamp(heatRobustZ / 3, -1, 1));
    const changeScore = toFixedNumber(
      clamp(0.65 * surgeScore + 0.35 * Math.max(0, impactMomentum), 0, 1),
    );
    const anomalyScore = toFixedNumber(
      clamp(
        Math.abs(heatRobustZ) / params.anomalyZDivisor +
          Math.max(0, topImpactShare - 0.7),
        0,
        1,
      ),
    );
    const trendScore = toFixedNumber(
      clamp(
        params.trendWeightHeatChange * velocityScore +
          params.trendWeightSurge * surgeScore +
          params.trendWeightDispersion * (current.dispersionScore - 0.5) +
          params.trendWeightImpactMomentum * impactMomentum +
          params.trendWeightReliability * (sampleReliability - 0.5),
        -1,
        1,
      ),
    );

    const windowComplete =
      current.hasNewPosts &&
      current.hasActiveUsers &&
      current.hasSubscribers &&
      current.sampledPostCount > 0;

    points.push({
      targetId: args.targetId,
      windowStart: current.windowStart,
      windowEnd: current.windowEnd,
      granularity: current.granularity,
      newPosts: current.newPosts,
      activeUsers: current.activeUsers,
      subscribers: current.subscribers,
      scoreSum: current.scoreSum,
      commentSum: current.commentSum,
      highScorePostCount: current.highScorePostCount,
      sampledPostCount: current.sampledPostCount,
      activePostRatio: toFixedNumber(current.activePostRatio),
      deltaNewPostsVsPrevWindow: current.newPosts - (previous?.newPosts ?? 0),
      deltaActiveUsersVsPrevWindow: current.activeUsers - (previous?.activeUsers ?? 0),
      heatChangePct,
      heatIndex,
      surgeScore,
      dispersionScore: toFixedNumber(current.dispersionScore),
      velocityScore,
      accelerationScore,
      baselineDeviationScore,
      changeScore,
      anomalyScore,
      trendScore,
      algorithmVersion: ALGORITHM_VERSION,
      algorithmParams: { ...params },
      sampleCount: Math.min(index, params.surgeLookbackWindows),
      windowComplete,
      scoreComponents: {
        heatRaw: toFixedNumber(heatRaw),
        heatRobustZ: toFixedNumber(heatRobustZ),
        surgeRaw: toFixedNumber(surgeRaw),
        impactScore: toFixedNumber(impactScore),
        impactPostCount,
        impactBreadth: toFixedNumber(impactBreadth),
        topImpactShare: toFixedNumber(topImpactShare),
        impactMomentum: toFixedNumber(impactMomentum),
        sampleReliability: toFixedNumber(sampleReliability),
        newPosts: current.newPosts,
        scoreSum: current.scoreSum,
        commentSum: current.commentSum,
        highScorePostCount: current.highScorePostCount,
        sampledPostCount: current.sampledPostCount,
        activePostRatio: toFixedNumber(current.activePostRatio),
      },
    });

    heatRawSeries.push(heatRaw);
    previousHeatIndex = heatIndex;
    previousVelocity = velocityScore;
    previousImpactScore = impactScore;
  }

  return points;
}

function robustZScore(current: number, history: number[]): number {
  if (history.length < 3) {
    return 0;
  }

  const medianValue = median(history);
  const absoluteDeviations = history.map((value) => Math.abs(value - medianValue));
  const mad = median(absoluteDeviations);
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
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

function log1p(value: number): number {
  return Math.log(1 + Math.max(0, value));
}

function toFixedNumber(value: number): number {
  return Number(value.toFixed(6));
}
