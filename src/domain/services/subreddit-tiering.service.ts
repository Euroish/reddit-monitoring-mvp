import type { SubredditTier } from "../entities/subreddit-daily-fact";

export interface SubredditTierRule {
  minSubscribers: number;
  tier: SubredditTier;
}

export const SUBREDDIT_TIER_RULES: readonly SubredditTierRule[] = [
  { minSubscribers: 1_000_000, tier: "large" },
  { minSubscribers: 100_000, tier: "mid" },
  { minSubscribers: 10_000, tier: "small" },
  { minSubscribers: 0, tier: "micro" },
] as const;

export function resolveSubredditTier(subscriberCount: number): SubredditTier {
  const safeSubscriberCount = Math.max(0, Math.floor(subscriberCount));
  return (
    SUBREDDIT_TIER_RULES.find((rule) => safeSubscriberCount >= rule.minSubscribers)?.tier ??
    "micro"
  );
}
