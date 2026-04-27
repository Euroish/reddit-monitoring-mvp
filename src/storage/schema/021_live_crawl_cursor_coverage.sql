BEGIN;

ALTER TABLE crawl_cursor
  ADD COLUMN IF NOT EXISTS live_requested_from_iso TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS live_coverage_status TEXT
    CHECK (live_coverage_status IN ('missing', 'partial', 'complete', 'source_limited')),
  ADD COLUMN IF NOT EXISTS live_listing_horizon_hit BOOLEAN;

COMMIT;
