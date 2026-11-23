-- 063_social_intelligence_monitors_and_rollups.sql
-- Semrush-style Keyword, KOL Author, and Subreddit Batch Monitors
-- plus Umami-style incremental 6h/1d rollup buckets in PG16.

BEGIN;

CREATE TABLE IF NOT EXISTS intel_monitor (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('keyword', 'author_list', 'community_bundle')),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  config JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  schedule_interval_hours INTEGER NOT NULL DEFAULT 6 CHECK (schedule_interval_hours BETWEEN 1 AND 168),
  daily_item_budget INTEGER NOT NULL DEFAULT 1000 CHECK (daily_item_budget BETWEEN 20 AND 20000),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intel_monitor_owner
  ON intel_monitor (owner_user_id, kind, updated_at DESC);

CREATE TABLE IF NOT EXISTS intel_monitor_source (
  monitor_id UUID NOT NULL REFERENCES intel_monitor(id) ON DELETE CASCADE,
  collection_source_id UUID NOT NULL REFERENCES collection_source(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary', 'competitor', 'bundle_member')),
  target_label TEXT,
  PRIMARY KEY (monitor_id, collection_source_id)
);

CREATE INDEX IF NOT EXISTS idx_intel_monitor_source_cs
  ON intel_monitor_source (collection_source_id);

CREATE TABLE IF NOT EXISTS intel_monitor_target (
  id UUID PRIMARY KEY,
  monitor_id UUID NOT NULL REFERENCES intel_monitor(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('keyword', 'competitor_keyword', 'author', 'subreddit')),
  target_value TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('reddit', 'x', 'web', 'bluesky')),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (monitor_id, target_kind, platform, target_value)
);

CREATE TABLE IF NOT EXISTS intel_rollup_bucket (
  bucket_at TIMESTAMPTZ NOT NULL,
  bucket_size TEXT NOT NULL CHECK (bucket_size IN ('6h', '1d')),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('monitor', 'keyword', 'author', 'subreddit')),
  scope_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('reddit', 'x', 'web', 'bluesky', 'all')),
  post_count INTEGER NOT NULL DEFAULT 0 CHECK (post_count >= 0),
  comment_count INTEGER NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  unique_authors INTEGER NOT NULL DEFAULT 0 CHECK (unique_authors >= 0),
  sum_score BIGINT NOT NULL DEFAULT 0,
  sum_comments BIGINT NOT NULL DEFAULT 0,
  sum_views BIGINT NOT NULL DEFAULT 0,
  sum_likes BIGINT NOT NULL DEFAULT 0,
  sum_reposts BIGINT NOT NULL DEFAULT 0,
  sum_bookmarks BIGINT NOT NULL DEFAULT 0,
  avg_engagement_rate REAL,
  p90_engagement REAL,
  intent_counts JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(intent_counts) = 'object'),
  top_domains JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(top_domains) = 'array'),
  top_terms JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(top_terms) = 'array'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bucket_at, bucket_size, scope_kind, scope_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_intel_rollup_lookup
  ON intel_rollup_bucket (scope_kind, scope_id, bucket_size, bucket_at DESC);

COMMIT;
