-- Reddit-only MVP baseline schema (PostgreSQL)
-- Scope: modular monolith + async worker + connector boundary

BEGIN;

DO $$
BEGIN
  CREATE TYPE snapshot_granularity_enum AS ENUM ('15m', '1h', '1d');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  CREATE TYPE metric_name_enum AS ENUM (
    'subscribers',
    'active_users',
    'new_posts_15m',
    'score',
    'num_comments',
    'upvote_ratio'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

CREATE TABLE IF NOT EXISTS source (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO source (id, code, name)
VALUES ('11111111-1111-1111-1111-111111111111', 'reddit', 'Reddit')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS monitor_target (
  id UUID PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES source(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('subreddit')),
  external_id TEXT,
  canonical_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused')),
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, target_type, canonical_name)
);

CREATE TABLE IF NOT EXISTS account (
  id UUID PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES source(id),
  external_id TEXT NOT NULL,
  username TEXT NOT NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at_source TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  UNIQUE (source_id, external_id)
);

CREATE TABLE IF NOT EXISTS content (
  id UUID PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES source(id),
  target_id UUID NOT NULL REFERENCES monitor_target(id),
  account_id UUID REFERENCES account(id),
  external_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('post')),
  title TEXT NOT NULL,
  body_text TEXT,
  url TEXT,
  permalink TEXT NOT NULL,
  created_at_source TIMESTAMPTZ NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  UNIQUE (source_id, external_id)
);

CREATE TABLE IF NOT EXISTS collection_job (
  id UUID PRIMARY KEY,
  source_id UUID NOT NULL REFERENCES source(id),
  target_id UUID NOT NULL REFERENCES monitor_target(id),
  job_type TEXT NOT NULL CHECK (job_type IN (
    'collect_subreddit_about',
    'collect_subreddit_new_posts',
    'build_subreddit_trend_points'
  )),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'retrying')),
  scheduled_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  cursor TEXT,
  dedupe_key TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  UNIQUE (job_type, target_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS metrics_snapshot (
  id BIGSERIAL PRIMARY KEY,
  snapshot_at TIMESTAMPTZ NOT NULL,
  source_id UUID NOT NULL REFERENCES source(id),
  target_id UUID NOT NULL REFERENCES monitor_target(id),
  content_id UUID REFERENCES content(id),
  granularity snapshot_granularity_enum NOT NULL,
  metric_name metric_name_enum NOT NULL,
  metric_value NUMERIC NOT NULL,
  collection_job_id UUID NOT NULL REFERENCES collection_job(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_metrics_snapshot_scope
    CHECK (
      (
        metric_name IN ('subscribers', 'active_users', 'new_posts_15m')
        AND content_id IS NULL
      )
      OR
      (
        metric_name IN ('score', 'num_comments', 'upvote_ratio')
        AND content_id IS NOT NULL
      )
    )
);

-- Handle nullable content_id with two unique indexes (target-level vs content-level snapshots)
CREATE UNIQUE INDEX IF NOT EXISTS uq_metrics_snapshot_target_level
  ON metrics_snapshot (target_id, granularity, metric_name, snapshot_at)
  WHERE content_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_metrics_snapshot_content_level
  ON metrics_snapshot (target_id, content_id, granularity, metric_name, snapshot_at)
  WHERE content_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS raw_reddit_event (
  id BIGSERIAL PRIMARY KEY,
  collection_job_id UUID NOT NULL REFERENCES collection_job(id),
  target_id UUID NOT NULL REFERENCES monitor_target(id),
  endpoint TEXT NOT NULL,
  request_params JSONB NOT NULL,
  http_status INTEGER NOT NULL,
  response_headers JSONB NOT NULL,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS subreddit_trend_point (
  target_id UUID NOT NULL REFERENCES monitor_target(id),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  new_posts INTEGER NOT NULL,
  delta_new_posts_vs_prev_window INTEGER NOT NULL,
  delta_active_users_vs_prev_window INTEGER NOT NULL,
  trend_score NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (target_id, window_start, window_end)
);

CREATE INDEX IF NOT EXISTS idx_collection_job_status_sched
  ON collection_job (status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_metrics_snapshot_target_time
  ON metrics_snapshot (target_id, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_raw_reddit_event_target_time
  ON raw_reddit_event (target_id, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_subreddit_trend_point_target_window
  ON subreddit_trend_point (target_id, window_start DESC);

COMMIT;
