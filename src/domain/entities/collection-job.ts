import type { ISODateTime, SourceCode, UUID } from "../../shared/types/common";
import type { CrawlMode } from "./crawl-cursor";

export type CollectionJobType =
  | "collect_subreddit_about"
  | "collect_subreddit_new_posts"
  | "build_subreddit_trend_points";

export type CollectionJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "retrying"
  | "dead_letter";

export interface CollectionJob {
  id: UUID;
  source: SourceCode;
  targetId: UUID;
  jobType: CollectionJobType;
  crawlMode?: CrawlMode;
  payload?: Record<string, unknown>;
  status: CollectionJobStatus;
  scheduledAt: ISODateTime;
  startedAt?: ISODateTime;
  finishedAt?: ISODateTime;
  cursor?: string;
  dedupeKey: string;
  retryCount: number;
  nextRunAt?: ISODateTime;
  deadLetteredAt?: ISODateTime;
  errorMessage?: string;
}
