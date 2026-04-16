-- Additive R3 base table for post-level growth facts used by driver scoring.
-- Stores same-age cohort normalized velocity metrics with explicit algorithm versioning.

BEGIN;

DO $$
BEGIN
  CREATE TYPE post_growth_age_bucket_enum AS ENUM ('1h', '6h', '24h');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

CREATE TABLE IF NOT EXISTS post_growth_fact (
  target_id UUID NOT NULL REFERENCES monitor_target(id),
  content_id UUID NOT NULL REFERENCES content(id),
  age_bucket post_growth_age_bucket_enum NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  age_minutes INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  comments INTEGER NOT NULL DEFAULT 0,
  score_velocity_per_hour NUMERIC NOT NULL DEFAULT 0,
  comment_velocity_per_hour NUMERIC NOT NULL DEFAULT 0,
  cohort_post_count INTEGER NOT NULL DEFAULT 0,
  cohort_median_score_velocity NUMERIC NOT NULL DEFAULT 0,
  cohort_median_comment_velocity NUMERIC NOT NULL DEFAULT 0,
  velocity_z_score NUMERIC NOT NULL DEFAULT 0,
  driver_score NUMERIC NOT NULL DEFAULT 0,
  algorithm_version TEXT NOT NULL DEFAULT 'post_growth_v1',
  explain_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (target_id, content_id, age_bucket, observed_at),
  CONSTRAINT ck_post_growth_fact_non_negative_counts
    CHECK (
      age_minutes >= 0
      AND score >= 0
      AND comments >= 0
      AND cohort_post_count >= 0
    ),
  CONSTRAINT ck_post_growth_fact_driver_score_range
    CHECK (driver_score >= 0 AND driver_score <= 100)
);

CREATE INDEX IF NOT EXISTS idx_post_growth_fact_target_observed
  ON post_growth_fact (target_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_post_growth_fact_target_bucket_observed
  ON post_growth_fact (target_id, age_bucket, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_post_growth_fact_content_observed
  ON post_growth_fact (content_id, observed_at DESC);

COMMIT;
