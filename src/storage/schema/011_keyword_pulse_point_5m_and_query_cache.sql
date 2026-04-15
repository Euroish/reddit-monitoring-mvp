BEGIN;

ALTER TABLE keyword_query_sample_post
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'index',
  ADD COLUMN IF NOT EXISTS data_quality TEXT NOT NULL DEFAULT 'medium';

CREATE TABLE IF NOT EXISTS keyword_pulse_point_5m (
  query_id UUID NOT NULL REFERENCES keyword_query_session(id) ON DELETE CASCADE,
  bucket_start TIMESTAMPTZ NOT NULL,
  bucket_end TIMESTAMPTZ NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('index', 'live', 'backfill')),
  mention_count INTEGER NOT NULL DEFAULT 0,
  qualified_mention_count INTEGER NOT NULL DEFAULT 0,
  mention_rate NUMERIC NOT NULL DEFAULT 0 CHECK (mention_rate >= 0 AND mention_rate <= 1),
  qualified_mention_rate NUMERIC NOT NULL DEFAULT 0 CHECK (qualified_mention_rate >= 0 AND qualified_mention_rate <= 1),
  data_quality TEXT NOT NULL CHECK (data_quality IN ('low', 'medium', 'high')),
  representative_samples JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (query_id, bucket_start, source_type)
);

CREATE INDEX IF NOT EXISTS idx_keyword_pulse_point_5m_query_bucket
  ON keyword_pulse_point_5m (query_id, bucket_start DESC);

CREATE INDEX IF NOT EXISTS idx_keyword_query_session_cache_lookup
  ON keyword_query_session (normalized_query_text, canonical_subreddit, updated_at DESC);

COMMIT;
