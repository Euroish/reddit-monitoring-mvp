-- Macro trend score upgrade.
-- Goal: persist product-level metrics (heat/surge/dispersion) with explainable window aggregates.

BEGIN;

ALTER TABLE subreddit_trend_point
  ADD COLUMN IF NOT EXISTS score_sum INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS comment_sum INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS high_score_post_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sampled_post_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active_post_ratio NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS heat_change_pct NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS heat_index NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS surge_score NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dispersion_score NUMERIC NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE subreddit_trend_point
    ADD CONSTRAINT ck_subreddit_trend_point_non_negative_counts
    CHECK (
      score_sum >= 0
      AND comment_sum >= 0
      AND high_score_post_count >= 0
      AND sampled_post_count >= 0
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  ALTER TABLE subreddit_trend_point
    ADD CONSTRAINT ck_subreddit_trend_point_ratio_range
    CHECK (
      active_post_ratio >= 0 AND active_post_ratio <= 1
      AND surge_score >= 0 AND surge_score <= 1
      AND dispersion_score >= 0 AND dispersion_score <= 1
      AND heat_index >= 0 AND heat_index <= 100
    );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

CREATE INDEX IF NOT EXISTS idx_subreddit_trend_point_window_heat
  ON subreddit_trend_point (window_start DESC, heat_index DESC);

CREATE INDEX IF NOT EXISTS idx_subreddit_trend_point_window_surge
  ON subreddit_trend_point (window_start DESC, surge_score DESC);

COMMIT;

