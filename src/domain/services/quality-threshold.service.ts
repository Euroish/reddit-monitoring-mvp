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

const FIXED_QUALIFIED_SCORE_THRESHOLD = 20;
const FIXED_QUALIFIED_COMMENT_THRESHOLD = 20;
const TIER_BASE_THRESHOLDS: Record<SubredditTier, { score: number; comments: number }> = {
  micro: { score: 4, comments: 2 },
  small: { score: 8, comments: 3 },
  mid: { score: 14, comments: 5 },
  large: { score: 18, comments: 7 },
};

export function resolveDailyQualityThreshold(args: {
  tier: SubredditTier;
  posts: DailyPostQualitySignal[];
}): DailyQualityThresholdResult {
  void args.posts;
  const base = TIER_BASE_THRESHOLDS[args.tier];
  if (base) {
    return {
      score: base.score,
      comments: base.comments,
      percentileScore: base.score,
      percentileComments: base.comments,
    };
  }
  void args.posts;
  return {
    score: FIXED_QUALIFIED_SCORE_THRESHOLD,
    comments: FIXED_QUALIFIED_COMMENT_THRESHOLD,
    percentileScore: FIXED_QUALIFIED_SCORE_THRESHOLD,
    percentileComments: FIXED_QUALIFIED_COMMENT_THRESHOLD,
  };
}

export function isQualifiedDailyPost(args: {
  score: number;
  comments: number;
  threshold: Pick<DailyQualityThresholdResult, "score" | "comments">;
}): boolean {
  const score = Math.max(0, args.score);
  const comments = Math.max(0, args.comments);
  const standardQualified =
    score >= args.threshold.score &&
    comments >= args.threshold.comments;
  const balancedQualified =
    score >= Math.ceil(args.threshold.score * 0.6) &&
    comments >= Math.ceil(args.threshold.comments * 0.6);
  const commercialIntentQualified =
    score >= args.threshold.score ||
    comments >= args.threshold.comments;
  const breakoutScoreQualified =
    score >= args.threshold.score * 2 &&
    comments >= Math.max(3, Math.floor(args.threshold.comments / 2));
  const breakoutDiscussionQualified =
    comments >= args.threshold.comments * 4 &&
    score >= Math.max(5, Math.floor(args.threshold.score / 3));
  return (
    standardQualified ||
    balancedQualified ||
    commercialIntentQualified ||
    breakoutScoreQualified ||
    breakoutDiscussionQualified
  );
}
