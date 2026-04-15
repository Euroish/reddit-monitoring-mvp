import type { ISODateTime, UUID } from "../../shared/types/common";

export interface RedditCollectSubredditAboutArgs {
  subreddit: string;
}

export interface RedditCollectSubredditPostsArgs {
  subreddit: string;
  limit: number;
  after?: string;
}

export interface RedditAboutPayload {
  data: {
    display_name: string;
    name?: string;
    subscribers?: number;
    accounts_active?: number;
  };
}

export interface RedditListingChild<TData = Record<string, unknown>> {
  kind: string;
  data: TData;
}

export interface RedditListingPayload<TData = Record<string, unknown>> {
  data: {
    after?: string;
    children: RedditListingChild<TData>[];
  };
}

export interface RedditPostData {
  name: string;
  id: string;
  subreddit: string;
  author: string;
  title: string;
  selftext?: string;
  url?: string;
  permalink: string;
  created_utc: number;
  score?: number;
  num_comments?: number;
  upvote_ratio?: number;
}

export interface NormalizedSubredditSnapshot {
  targetCanonicalName: string;
  snapshotAt: ISODateTime;
  subscribers?: number;
  activeUsers?: number;
}

export interface NormalizedPostUpsert {
  targetId: UUID;
  accountExternalId: string;
  externalId: string;
  title: string;
  bodyText?: string;
  url?: string;
  permalink: string;
  createdAtSource: ISODateTime;
}

export interface NormalizedPostMetricPoint {
  externalId: string;
  snapshotAt: ISODateTime;
  score?: number;
  numComments?: number;
  upvoteRatio?: number;
}

