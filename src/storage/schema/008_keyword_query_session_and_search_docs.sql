-- Keyword Pulse P0 baseline:
-- - query session persistence
-- - sample post persistence
-- - index-like search document projection

BEGIN;

CREATE TABLE IF NOT EXISTS post_search_document (
  content_id UUID PRIMARY KEY REFERENCES content(id) ON DELETE CASCADE,
  target_id UUID NOT NULL REFERENCES monitor_target(id) ON DELETE CASCADE,
  canonical_subreddit TEXT NOT NULL,
  title TEXT NOT NULL,
  body_snippet TEXT,
  permalink TEXT NOT NULL,
  created_at_source TIMESTAMPTZ NOT NULL,
  search_text TEXT NOT NULL,
  search_tsv TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', search_text)) STORED,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_search_document_subreddit_time
  ON post_search_document (canonical_subreddit, created_at_source DESC);

CREATE INDEX IF NOT EXISTS idx_post_search_document_search_tsv
  ON post_search_document USING GIN (search_tsv);

CREATE TABLE IF NOT EXISTS keyword_query_session (
  id UUID PRIMARY KEY,
  query_text TEXT NOT NULL,
  normalized_query_text TEXT NOT NULL,
  canonical_subreddit TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'initial_ready', 'live_refreshing', 'degraded', 'completed')),
  coverage_level TEXT NOT NULL CHECK (coverage_level IN ('low', 'medium', 'high')),
  support_count INTEGER NOT NULL DEFAULT 0,
  confidence_level TEXT NOT NULL CHECK (confidence_level IN ('low', 'medium', 'high')),
  mention_rate NUMERIC NOT NULL DEFAULT 0 CHECK (mention_rate >= 0 AND mention_rate <= 1),
  qualified_mention_rate NUMERIC NOT NULL DEFAULT 0 CHECK (qualified_mention_rate >= 0 AND qualified_mention_rate <= 1),
  source_type_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  degraded_reason TEXT,
  explain_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_keyword_query_session_created
  ON keyword_query_session (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_keyword_query_session_status_created
  ON keyword_query_session (status, created_at DESC);

CREATE TABLE IF NOT EXISTS keyword_query_sample_post (
  query_id UUID NOT NULL REFERENCES keyword_query_session(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  rank SMALLINT NOT NULL CHECK (rank > 0),
  match_score NUMERIC NOT NULL DEFAULT 0,
  canonical_subreddit TEXT NOT NULL,
  title TEXT NOT NULL,
  permalink TEXT NOT NULL,
  created_at_source TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (query_id, content_id)
);

CREATE INDEX IF NOT EXISTS idx_keyword_query_sample_post_query_rank
  ON keyword_query_sample_post (query_id, rank);

CREATE TABLE IF NOT EXISTS keyword_query_result_summary (
  query_id UUID NOT NULL REFERENCES keyword_query_session(id) ON DELETE CASCADE,
  bucket_start TIMESTAMPTZ NOT NULL,
  mention_count INTEGER NOT NULL DEFAULT 0,
  qualified_mention_count INTEGER NOT NULL DEFAULT 0,
  mention_rate NUMERIC NOT NULL DEFAULT 0 CHECK (mention_rate >= 0 AND mention_rate <= 1),
  qualified_mention_rate NUMERIC NOT NULL DEFAULT 0 CHECK (qualified_mention_rate >= 0 AND qualified_mention_rate <= 1),
  source_type TEXT NOT NULL DEFAULT 'index',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (query_id, bucket_start)
);

COMMIT;

