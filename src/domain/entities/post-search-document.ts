import type { ISODateTime, UUID } from "../../shared/types/common";

export interface PostSearchDocument {
  contentId: UUID;
  targetId: UUID;
  canonicalSubreddit: string;
  title: string;
  bodySnippet?: string;
  permalink: string;
  createdAtSource: ISODateTime;
  matchScore?: number;
}

