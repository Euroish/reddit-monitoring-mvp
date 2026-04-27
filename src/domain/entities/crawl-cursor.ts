import type { ISODateTime, UUID } from "../../shared/types/common";

export type CrawlMode = "live" | "backfill";
export type BackfillCoverageStatus =
  | "missing"
  | "progressing"
  | "covered"
  | "source_limited"
  | "saturated_before_15d";
export type BackfillStopReason =
  | "awaiting_progress"
  | "coverage_reached"
  | "terminal_eof"
  | "cursor_saturated"
  | "iteration_budget_exhausted";
export type LiveCoverageStatus = "missing" | "partial" | "complete" | "source_limited";

export interface CrawlCursor {
  provider: string;
  targetId: UUID;
  mode: CrawlMode;
  cursor: string;
  rewindCursor?: string;
  oldestObservedAt?: ISODateTime;
  newestObservedAt?: ISODateTime;
  liveRequestedFromIso?: ISODateTime;
  liveCoverageStatus?: LiveCoverageStatus;
  liveListingHorizonHit?: boolean;
  backfillTargetFromIso?: ISODateTime;
  backfillCoverageStatus?: BackfillCoverageStatus;
  backfillStopReason?: BackfillStopReason;
  lastFetchedAt?: ISODateTime;
  updatedAt: ISODateTime;
}
