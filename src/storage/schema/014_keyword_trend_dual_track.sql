-- Keyword trend dual-track upgrade.
-- Goal: support auto-keyword and explicit-query materialization with query scope and explain payload.

BEGIN;

DO $$
BEGIN
  CREATE TYPE keyword_trend_track_enum AS ENUM ('auto_keyword', 'explicit_query');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

DO $$
BEGIN
  CREATE TYPE keyword_query_scope_enum AS ENUM ('subreddit', 'global');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

ALTER TABLE keyword_trend_daily
  ADD COLUMN IF NOT EXISTS track keyword_trend_track_enum NOT NULL DEFAULT 'auto_keyword',
  ADD COLUMN IF NOT EXISTS normalized_query_text TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS query_scope keyword_query_scope_enum NOT NULL DEFAULT 'subreddit',
  ADD COLUMN IF NOT EXISTS algorithm_version TEXT NOT NULL DEFAULT 'keyword_trend_v2_dual_track',
  ADD COLUMN IF NOT EXISTS explain_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE keyword_trend_daily
SET normalized_query_text = keyword
WHERE normalized_query_text = '';

ALTER TABLE keyword_trend_daily
  DROP CONSTRAINT IF EXISTS keyword_trend_daily_pkey;

ALTER TABLE keyword_trend_daily
  ADD CONSTRAINT keyword_trend_daily_pkey
  PRIMARY KEY (target_id, day, track, normalized_query_text, query_scope);

CREATE INDEX IF NOT EXISTS idx_keyword_trend_daily_target_day_track
  ON keyword_trend_daily (target_id, day DESC, track);

CREATE INDEX IF NOT EXISTS idx_keyword_trend_daily_target_scope_query_day
  ON keyword_trend_daily (target_id, query_scope, normalized_query_text, day DESC);

COMMIT;

