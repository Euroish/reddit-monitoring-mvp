import type { SubredditTier } from "../entities/subreddit-daily-fact";

export interface DailyPostQualitySignal {
  score: number;
  comments: number;
}

export interface DailyQualityThresholdResult {
  score: number;
  comments: number;
  percentileScore: number;
  percentileComments: number;
}

const TIER_BASE_THRESHOLDS: Record<SubredditTier, { score: number; comments: number }> = {
  micro: { score: 5, comments: 2 },
  small: { score: 10, comments: 5 },
  mid: { score: 25, comments: 10 },
  large: { score: 40, comments: 20 },
};

const QUALITY_PERCENTILE = 0.75;
const PERCENTILE_FLOOR_SCALE = 0.5;

export function resolveDailyQualityThreshold(args: {
  tier: SubredditTier;
  posts: DailyPostQualitySignal[];
}): DailyQualityThresholdResult {
  const base = TIER_BASE_THRESHOLDS[args.tier];
  const scoreValues = args.posts.map((post) => Math.max(0, post.score));
  const commentValues = args.posts.map((post) => Math.max(0, post.comments));
  const percentileScore = Math.round(percentile(scoreValues, QUALITY_PERCENTILE));
  const percentileComments = Math.round(percentile(commentValues, QUALITY_PERCENTILE));

  return {
    score: Math.max(base.score, Math.round(percentileScore * PERCENTILE_FLOOR_SCALE)),
    comments: Math.max(
      base.comments,
      Math.round(percentileComments * PERCENTILE_FLOOR_SCALE),
    ),
    percentileScore,
    percentileComments,
  };
}

export function isQualifiedDailyPost(args: {
  score: number;
  comments: number;
  threshold: Pick<DailyQualityThresholdResult, "score" | "comments">;
}): boolean {
  return (
    Math.max(0, args.score) >= args.threshold.score &&
    Math.max(0, args.comments) >= args.threshold.comments
  );
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const position = clamp(p, 0, 1) * (sorted.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] ?? 0;
  const upper = sorted[upperIndex] ?? lower;
  if (lowerIndex === upperIndex) {
    return lower;
  }
  const weight = position - lowerIndex;
  return lower + (upper - lower) * weight;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
