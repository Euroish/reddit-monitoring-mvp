import type { ISODateTime, UUID } from "../../shared/types/common";

export type SubredditTier = "micro" | "small" | "mid" | "large";

export interface SubredditDailyFact {
  targetId: UUID;
  day: string;
  postVolume: number;
  qualifiedPostVolume: number;
  sampledPostVolume: number;
  scoreSum: number;
  commentSum: number;
  subscriberCount: number;
  activeUserCount: number;
  activePostRatio: number;
  dispersionScore: number;
  impactScoreSum: number;
  impactPostVolume: number;
  topImpactShare: number;
  heatPrice: number;
  heatChangePct: number;
  ema7: number;
  ema30: number;
  subredditTier: SubredditTier;
  qualityThresholdScore: number;
  qualityThresholdComments: number;
  algorithmVersion: string;
  explainPayload: Record<string, unknown>;
  updatedAt?: ISODateTime;
}
