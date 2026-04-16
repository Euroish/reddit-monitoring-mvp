import type { ISODateTime, UUID } from "../../shared/types/common";

export type KeywordTrendSourceType = "live" | "backfill";
export type KeywordTrendTrack = "auto_keyword" | "explicit_query";
export type KeywordTrendQueryScope = "subreddit" | "global";

export interface KeywordTrendDaily {
  targetId: UUID;
  day: string; // YYYY-MM-DD (UTC)
  keyword: string;
  track: KeywordTrendTrack;
  normalizedQueryText: string;
  queryScope: KeywordTrendQueryScope;
  sampledPosts: number;
  matchedPosts: number;
  qualifiedMatchedPosts: number;
  mentionRate: number;
  qualifiedMentionRate: number;
  matchedScoreSum: number;
  matchedCommentSum: number;
  keywordHeat: number;
  algorithmVersion: string;
  explainPayload: Record<string, unknown>;
  sourceType: KeywordTrendSourceType;
  updatedAt?: ISODateTime;
}
