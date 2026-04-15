import type { CrawlMode } from "../domain/entities/crawl-cursor";

export interface RedditCollectionJobInput {
  targetId: string;
  subreddit: string;
  nowIso: string;
  crawlMode?: CrawlMode;
}

export interface RedditPostCandidateFilterConfig {
  minScore?: number;
  minComments?: number;
  mode?: "and" | "or";
}

export interface RedditNewPostsJobPayload {
  postLimit?: number;
  providerHint?: string;
  candidateFilter?: RedditPostCandidateFilterConfig;
}
