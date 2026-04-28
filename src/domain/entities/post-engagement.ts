import type { ISODateTime, SourceCode, UUID } from "../../shared/types/common";

export interface PostEngagementLatest {
  contentId: UUID;
  targetId: UUID;
  source: SourceCode;
  observedAt: ISODateTime;
  score?: number;
  numComments?: number;
  upvoteRatio?: number;
  collectionJobId: UUID;
  createdAt?: ISODateTime;
  updatedAt?: ISODateTime;
}

export interface PostEngagementWindow {
  contentId: UUID;
  targetId: UUID;
  source: SourceCode;
  windowStart: ISODateTime;
  windowEnd: ISODateTime;
  observedAt: ISODateTime;
  score?: number;
  numComments?: number;
  upvoteRatio?: number;
  collectionJobId: UUID;
  createdAt?: ISODateTime;
  updatedAt?: ISODateTime;
}
