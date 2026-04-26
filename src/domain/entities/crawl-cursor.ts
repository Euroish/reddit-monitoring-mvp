import type { ISODateTime, UUID } from "../../shared/types/common";

export type CrawlMode = "live" | "backfill";

export interface CrawlCursor {
  provider: string;
  targetId: UUID;
  mode: CrawlMode;
  cursor: string;
  rewindCursor?: string;
  oldestObservedAt?: ISODateTime;
  newestObservedAt?: ISODateTime;
  lastFetchedAt?: ISODateTime;
  updatedAt: ISODateTime;
}
