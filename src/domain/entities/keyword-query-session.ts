import type { ISODateTime, UUID } from "../../shared/types/common";

export type KeywordQuerySessionStatus =
  | "queued"
  | "initial_ready"
  | "live_refreshing"
  | "degraded"
  | "completed";

export type CoverageLevel = "low" | "medium" | "high";
export type ConfidenceLevel = "low" | "medium" | "high";
export type KeywordQuerySourceType = "index" | "live" | "backfill";
export type DataQualityLevel = "low" | "medium" | "high";

export interface KeywordQuerySession {
  id: UUID;
  queryText: string;
  normalizedQueryText: string;
  canonicalSubreddit?: string;
  status: KeywordQuerySessionStatus;
  coverageLevel: CoverageLevel;
  supportCount: number;
  confidenceLevel: ConfidenceLevel;
  mentionRate: number;
  qualifiedMentionRate: number;
  sourceTypeSummary: Record<string, number>;
  degradedReason?: string;
  explainPayload: Record<string, unknown>;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface KeywordQuerySamplePost {
  queryId: UUID;
  contentId: UUID;
  rank: number;
  matchScore: number;
  sourceType: KeywordQuerySourceType;
  dataQuality: DataQualityLevel;
  canonicalSubreddit: string;
  title: string;
  permalink: string;
  createdAtSource: ISODateTime;
}

export interface KeywordQueryDataQuality {
  level: DataQualityLevel;
  coverageLevel: CoverageLevel;
  confidenceLevel: ConfidenceLevel;
  supportCount: number;
  mentionRate: number;
  qualifiedMentionRate: number;
  degradedReason?: string;
}

export interface KeywordPulsePoint5m {
  queryId: UUID;
  bucketStart: ISODateTime;
  bucketEnd: ISODateTime;
  sourceType: KeywordQuerySourceType;
  mentionCount: number;
  qualifiedMentionCount: number;
  mentionRate: number;
  qualifiedMentionRate: number;
  dataQuality: DataQualityLevel;
  representativeSamples: KeywordQuerySamplePost[];
  updatedAt: ISODateTime;
}
