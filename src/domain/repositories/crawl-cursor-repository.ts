import type {
  BackfillCoverageStatus,
  BackfillStopReason,
  CrawlCursor,
  LiveCoverageStatus,
  CrawlMode,
} from "../entities/crawl-cursor";

export interface ResolveCrawlCursorInput {
  provider: string;
  targetId: string;
  mode: CrawlMode;
}

export interface UpsertCrawlCursorInput extends ResolveCrawlCursorInput {
  cursor: string;
  rewindCursor?: string;
  oldestObservedAt?: string;
  newestObservedAt?: string;
  liveRequestedFromIso?: string;
  liveCoverageStatus?: LiveCoverageStatus;
  liveListingHorizonHit?: boolean;
  backfillTargetFromIso?: string;
  backfillCoverageStatus?: BackfillCoverageStatus;
  backfillStopReason?: BackfillStopReason;
  lastFetchedAt?: string;
  updatedAt: string;
}

export interface CrawlCursorRepository {
  resolve(input: ResolveCrawlCursorInput): Promise<CrawlCursor | null>;
  list(args: { mode?: CrawlMode; targetId?: string; provider?: string }): Promise<CrawlCursor[]>;
  upsert(input: UpsertCrawlCursorInput): Promise<void>;
}
