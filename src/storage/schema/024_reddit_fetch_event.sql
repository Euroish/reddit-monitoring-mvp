BEGIN;

CREATE TABLE IF NOT EXISTS reddit_fetch_event (
  id BIGSERIAL PRIMARY KEY,
  collection_job_id UUID NOT NULL REFERENCES collection_job(id),
  target_id UUID NOT NULL REFERENCES monitor_target(id),
  provider TEXT,
  endpoint TEXT NOT NULL,
  listing TEXT,
  time_range TEXT,
  http_status INTEGER NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  request_limit INTEGER,
  returned_count INTEGER,
  after_cursor TEXT,
  next_cursor TEXT,
  payload_hash TEXT,
  retention_reason TEXT,
  raw_event_id BIGINT REFERENCES raw_reddit_event(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reddit_fetch_event_target_time
  ON reddit_fetch_event (target_id, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_reddit_fetch_event_job
  ON reddit_fetch_event (collection_job_id);

COMMIT;
