-- P0 incremental crawl + provider quality reconciliation baseline.
-- Adds:
-- - crawl_cursor: provider+target+mode scoped incremental cursor with rewind support.
-- - provider_health_window: 5m rolling evidence buckets for provider quality/degradation.

BEGIN;

CREATE TABLE IF NOT EXISTS crawl_cursor (
  provider TEXT NOT NULL,
  target_id UUID NOT NULL REFERENCES monitor_target(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('live', 'backfill')),
  cursor TEXT NOT NULL,
  rewind_cursor TEXT,
  last_fetched_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, target_id, mode)
);

CREATE INDEX IF NOT EXISTS idx_crawl_cursor_target_mode
  ON crawl_cursor (target_id, mode, updated_at DESC);

CREATE TABLE IF NOT EXISTS provider_health_window (
  provider TEXT NOT NULL,
  target_id UUID NOT NULL REFERENCES monitor_target(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('live', 'backfill')),
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  success_count INTEGER NOT NULL DEFAULT 0 CHECK (success_count >= 0),
  empty_response_count INTEGER NOT NULL DEFAULT 0 CHECK (empty_response_count >= 0),
  fallback_count INTEGER NOT NULL DEFAULT 0 CHECK (fallback_count >= 0),
  candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  accepted_count INTEGER NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  filtered_out_count INTEGER NOT NULL DEFAULT 0 CHECK (filtered_out_count >= 0),
  error_count INTEGER NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  rate_limit_count INTEGER NOT NULL DEFAULT 0 CHECK (rate_limit_count >= 0),
  timeout_count INTEGER NOT NULL DEFAULT 0 CHECK (timeout_count >= 0),
  circuit_open_count INTEGER NOT NULL DEFAULT 0 CHECK (circuit_open_count >= 0),
  last_status_code INTEGER,
  last_error_code TEXT,
  last_error_message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, target_id, mode, window_start)
);

CREATE INDEX IF NOT EXISTS idx_provider_health_window_recent
  ON provider_health_window (window_start DESC, provider, mode, target_id);

COMMIT;

