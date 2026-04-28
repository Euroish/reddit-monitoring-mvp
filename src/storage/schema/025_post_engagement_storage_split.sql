BEGIN;

CREATE TABLE IF NOT EXISTS post_engagement_latest (
  content_id UUID PRIMARY KEY REFERENCES content(id),
  target_id UUID NOT NULL REFERENCES monitor_target(id),
  source_id UUID NOT NULL REFERENCES source(id),
  observed_at TIMESTAMPTZ NOT NULL,
  score NUMERIC,
  num_comments NUMERIC,
  upvote_ratio NUMERIC,
  collection_job_id UUID NOT NULL REFERENCES collection_job(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_post_engagement_latest_payload
    CHECK (score IS NOT NULL OR num_comments IS NOT NULL OR upvote_ratio IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_post_engagement_latest_target_observed
  ON post_engagement_latest (target_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS post_engagement_window (
  target_id UUID NOT NULL REFERENCES monitor_target(id),
  content_id UUID NOT NULL REFERENCES content(id),
  source_id UUID NOT NULL REFERENCES source(id),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  score NUMERIC,
  num_comments NUMERIC,
  upvote_ratio NUMERIC,
  collection_job_id UUID NOT NULL REFERENCES collection_job(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pk_post_engagement_window PRIMARY KEY (target_id, content_id, window_start),
  CONSTRAINT ck_post_engagement_window_bounds CHECK (window_end > window_start),
  CONSTRAINT ck_post_engagement_window_payload
    CHECK (score IS NOT NULL OR num_comments IS NOT NULL OR upvote_ratio IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_post_engagement_window_target_window
  ON post_engagement_window (target_id, window_start DESC);

COMMIT;
