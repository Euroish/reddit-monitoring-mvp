BEGIN;

CREATE TABLE IF NOT EXISTS subreddit_collection_coverage (
  target_id UUID NOT NULL REFERENCES monitor_target(id),
  day DATE NOT NULL,
  coverage_status TEXT NOT NULL CHECK (
    coverage_status IN ('complete', 'partial', 'source_limited', 'unknown')
  ),
  coverage_basis TEXT NOT NULL CHECK (
    coverage_basis IN (
      'live_continuous',
      'backfill_reached_day_start',
      'terminal_eof_reached',
      'iteration_budget_exhausted',
      'cursor_saturated',
      'missed_live_window',
      'rate_limited',
      'observed_without_proof',
      'no_collection_evidence'
    )
  ),
  observed_post_count INTEGER NOT NULL DEFAULT 0 CHECK (observed_post_count >= 0),
  total_eligible_post_count INTEGER NOT NULL DEFAULT 0 CHECK (total_eligible_post_count >= 0),
  first_seen_post_at TIMESTAMPTZ,
  last_seen_post_at TIMESTAMPTZ,
  oldest_new_listing_seen_at TIMESTAMPTZ,
  newest_new_listing_seen_at TIMESTAMPTZ,
  live_window_count INTEGER NOT NULL DEFAULT 0 CHECK (live_window_count >= 0),
  missed_live_window_count INTEGER NOT NULL DEFAULT 0 CHECK (missed_live_window_count >= 0),
  backfill_cursor TEXT,
  backfill_stop_reason TEXT,
  listing_horizon_hit BOOLEAN NOT NULL DEFAULT FALSE,
  source_limited BOOLEAN NOT NULL DEFAULT FALSE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (target_id, day)
);

CREATE INDEX IF NOT EXISTS idx_subreddit_collection_coverage_target_day
  ON subreddit_collection_coverage (target_id, day DESC);

CREATE INDEX IF NOT EXISTS idx_subreddit_collection_coverage_status_day
  ON subreddit_collection_coverage (coverage_status, day DESC);

COMMIT;
