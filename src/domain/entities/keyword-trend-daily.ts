import type { ISODateTime, UUID } from "../../shared/types/common";

export type KeywordTrendSourceType = "live" | "backfill";

export interface KeywordTrendDaily {
  targetId: UUID;
  day: string; // YYYY-MM-DD (UTC)
  keyword: string;
  sampledPosts: number;
  matchedPosts: number;
  qualifiedMatchedPosts: number;
  mentionRate: number;
  qualifiedMentionRate: number;
  matchedScoreSum: number;
  matchedCommentSum: number;
  keywordHeat: number;
  sourceType: KeywordTrendSourceType;
  updatedAt?: ISODateTime;
}

