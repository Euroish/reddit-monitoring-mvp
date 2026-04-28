import type { ISODateTime, UUID } from "../../shared/types/common";

export type SubredditCollectionCoverageStatus =
  | "complete"
  | "partial"
  | "source_limited"
  | "unknown";

export type SubredditCollectionCoverageBasis =
  | "live_continuous"
  | "backfill_reached_day_start"
  | "terminal_eof_reached"
  | "iteration_budget_exhausted"
  | "cursor_saturated"
  | "missed_live_window"
  | "rate_limited"
  | "observed_without_proof"
  | "no_collection_evidence";

export interface SubredditCollectionCoverage {
  targetId: UUID;
  day: string;
  coverageStatus: SubredditCollectionCoverageStatus;
  coverageBasis: SubredditCollectionCoverageBasis;
  observedPostCount: number;
  totalEligiblePostCount: number;
  firstSeenPostAt?: ISODateTime;
  lastSeenPostAt?: ISODateTime;
  oldestNewListingSeenAt?: ISODateTime;
  newestNewListingSeenAt?: ISODateTime;
  liveWindowCount: number;
  missedLiveWindowCount: number;
  backfillCursor?: string;
  backfillStopReason?: string;
  listingHorizonHit: boolean;
  sourceLimited: boolean;
  generatedAt: ISODateTime;
}
