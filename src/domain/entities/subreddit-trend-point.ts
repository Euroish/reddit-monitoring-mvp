import type { ISODateTime, UUID } from "../../shared/types/common";

export type TrendGranularity = "15m" | "1h" | "6h" | "1d";

export interface SubredditTrendPoint {
  targetId: UUID;
  windowStart: ISODateTime;
  windowEnd: ISODateTime;
  granularity?: TrendGranularity;
  newPosts: number;
  activeUsers?: number;
  subscribers?: number;
  scoreSum?: number;
  commentSum?: number;
  highScorePostCount?: number;
  sampledPostCount?: number;
  activePostRatio?: number;
  deltaNewPostsVsPrevWindow: number;
  deltaActiveUsersVsPrevWindow: number;
  heatChangePct?: number;
  heatIndex?: number;
  surgeScore?: number;
  dispersionScore?: number;
  velocityScore?: number;
  accelerationScore?: number;
  baselineDeviationScore?: number;
  changeScore?: number;
  anomalyScore?: number;
  trendScore: number;
  algorithmVersion?: string;
  algorithmParams?: Record<string, unknown>;
  sampleCount?: number;
  windowComplete?: boolean;
  buildJobId?: UUID;
  scoreComponents?: Record<string, unknown>;
}
