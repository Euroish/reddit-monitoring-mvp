-- Canonical day-level subreddit fact table.
-- Goal: persist day facts for heat, volume, quality-qualified counts, and EMA-based read models.

BEGIN;

DO $$
BEGIN
  CREATE TYPE subreddit_tier_enum AS ENUM ('micro', 'small', 'mid', 'large');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

CREATE TABLE IF NOT EXISTS subreddit_daily_fact (
  target_id UUID NOT NULL REFERENCES monitor_target(id),
  day DATE NOT NULL,
  post_volume INTEGER NOT NULL DEFAULT 0,
  qualified_post_volume INTEGER NOT NULL DEFAULT 0,
  sampled_post_volume INTEGER NOT NULL DEFAULT 0,
  score_sum INTEGER NOT NULL DEFAULT 0,
  comment_sum INTEGER NOT NULL DEFAULT 0,
  subscriber_count INTEGER NOT NULL DEFAULT 0,
  active_user_count INTEGER NOT NULL DEFAULT 0,
  active_post_ratio NUMERIC NOT NULL DEFAULT 0,
  dispersion_score NUMERIC NOT NULL DEFAULT 0,
  impact_score_sum NUMERIC NOT NULL DEFAULT 0,
  impact_post_volume INTEGER NOT NULL DEFAULT 0,
  top_impact_share NUMERIC NOT NULL DEFAULT 0,
  heat_price NUMERIC NOT NULL DEFAULT 0,
  heat_change_pct NUMERIC NOT NULL DEFAULT 0,
  ema7 NUMERIC NOT NULL DEFAULT 0,
  ema30 NUMERIC NOT NULL DEFAULT 0,
  subreddit_tier subreddit_tier_enum NOT NULL DEFAULT 'micro',
  quality_threshold_score INTEGER NOT NULL DEFAULT 0,
  quality_threshold_comments INTEGER NOT NULL DEFAULT 0,
  algorithm_version TEXT NOT NULL DEFAULT 'daily_fact_v1',
  explain_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (target_id, day),
  CONSTRAINT ck_subreddit_daily_fact_non_negative_counts
    CHECK (
      post_volume >= 0
      AND qualified_post_volume >= 0
      AND sampled_post_volume >= 0
      AND score_sum >= 0
      AND comment_sum >= 0
      AND subscriber_count >= 0
      AND active_user_count >= 0
      AND impact_post_volume >= 0
      AND quality_threshold_score >= 0
      AND quality_threshold_comments >= 0
    ),
  CONSTRAINT ck_subreddit_daily_fact_ratio_range
    CHECK (
      active_post_ratio >= 0 AND active_post_ratio <= 1
      AND dispersion_score >= 0 AND dispersion_score <= 1
      AND top_impact_share >= 0 AND top_impact_share <= 1
      AND heat_price >= 0 AND heat_price <= 100
    )
);

CREATE INDEX IF NOT EXISTS idx_subreddit_daily_fact_target_day
  ON subreddit_daily_fact (target_id, day DESC);

CREATE INDEX IF NOT EXISTS idx_subreddit_daily_fact_day_heat
  ON subreddit_daily_fact (day DESC, heat_price DESC);

COMMIT;
