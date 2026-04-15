-- Queue lane split and richer provider observability fields.
-- Goal:
-- - persist live/backfill queue lane on collection jobs
-- - expose duplicate/lag/provider-diff observability in provider_health_window

BEGIN;

ALTER TABLE collection_job
  ADD COLUMN IF NOT EXISTS crawl_mode TEXT;

DO $$
BEGIN
  ALTER TABLE collection_job
    ADD CONSTRAINT ck_collection_job_crawl_mode
    CHECK (crawl_mode IN ('live', 'backfill') OR crawl_mode IS NULL);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

CREATE INDEX IF NOT EXISTS idx_collection_job_crawl_mode_status_next_run
  ON collection_job (crawl_mode, status, next_run_at)
  WHERE status IN ('queued', 'retrying', 'running', 'dead_letter');

ALTER TABLE provider_health_window
  ADD COLUMN IF NOT EXISTS duplicate_post_count INTEGER NOT NULL DEFAULT 0 CHECK (duplicate_post_count >= 0),
  ADD COLUMN IF NOT EXISTS ingest_lag_seconds_sum BIGINT NOT NULL DEFAULT 0 CHECK (ingest_lag_seconds_sum >= 0),
  ADD COLUMN IF NOT EXISTS ingest_lag_sample_count INTEGER NOT NULL DEFAULT 0 CHECK (ingest_lag_sample_count >= 0),
  ADD COLUMN IF NOT EXISTS provider_diff_count INTEGER NOT NULL DEFAULT 0 CHECK (provider_diff_count >= 0),
  ADD COLUMN IF NOT EXISTS provider_diff_sample_count INTEGER NOT NULL DEFAULT 0 CHECK (provider_diff_sample_count >= 0);

COMMIT;
