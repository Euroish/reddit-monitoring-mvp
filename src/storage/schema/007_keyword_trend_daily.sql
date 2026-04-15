-- Keyword daily trend materialization.
-- Goal: persist reusable keyword trend aggregates for faster daily insights reads.

BEGIN;

DO $$
BEGIN
  CREATE TYPE keyword_trend_source_type_enum AS ENUM ('live', 'backfill');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

CREATE TABLE IF NOT EXISTS keyword_trend_daily (
  target_id UUID NOT NULL REFERENCES monitor_target(id),
  day DATE NOT NULL,
  keyword TEXT NOT NULL,
  sampled_posts INTEGER NOT NULL DEFAULT 0,
  matched_posts INTEGER NOT NULL DEFAULT 0,
  qualified_matched_posts INTEGER NOT NULL DEFAULT 0,
  mention_rate NUMERIC NOT NULL DEFAULT 0,
  qualified_mention_rate NUMERIC NOT NULL DEFAULT 0,
  matched_score_sum INTEGER NOT NULL DEFAULT 0,
  matched_comment_sum INTEGER NOT NULL DEFAULT 0,
  keyword_heat NUMERIC NOT NULL DEFAULT 0,
  source_type keyword_trend_source_type_enum NOT NULL DEFAULT 'live',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (target_id, day, keyword),
  CONSTRAINT ck_keyword_trend_daily_non_negative_counts
    CHECK (
      sampled_posts >= 0
      AND matched_posts >= 0
      AND qualified_matched_posts >= 0
      AND matched_score_sum >= 0
      AND matched_comment_sum >= 0
    ),
  CONSTRAINT ck_keyword_trend_daily_rate_range
    CHECK (
      mention_rate >= 0 AND mention_rate <= 1
      AND qualified_mention_rate >= 0 AND qualified_mention_rate <= 1
      AND keyword_heat >= 0 AND keyword_heat <= 1
    )
);

CREATE INDEX IF NOT EXISTS idx_keyword_trend_daily_target_day
  ON keyword_trend_daily (target_id, day DESC);

CREATE INDEX IF NOT EXISTS idx_keyword_trend_daily_target_keyword_day
  ON keyword_trend_daily (target_id, keyword, day DESC);

COMMIT;

