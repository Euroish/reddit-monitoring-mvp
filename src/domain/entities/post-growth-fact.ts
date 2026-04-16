import type { ISODateTime, UUID } from "../../shared/types/common";

export type PostGrowthAgeBucket = "1h" | "6h" | "24h";

export interface PostGrowthFact {
  targetId: UUID;
  contentId: UUID;
  ageBucket: PostGrowthAgeBucket;
  observedAt: ISODateTime;
  ageMinutes: number;
  score: number;
  comments: number;
  scoreVelocityPerHour: number;
  commentVelocityPerHour: number;
  cohortPostCount: number;
  cohortMedianScoreVelocity: number;
  cohortMedianCommentVelocity: number;
  velocityZScore: number;
  driverScore: number;
  algorithmVersion: string;
  explainPayload: Record<string, unknown>;
  updatedAt?: ISODateTime;
}
