-- 060_feed_personalization_and_seen.sql
-- Feed seen-item anti-join tracking, batched interaction events,
-- decayed multi-dimension user affinities, and explicit anti-filter-bubble preferences.

BEGIN;

CREATE TABLE IF NOT EXISTS feed_user_seen (
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, content_id)
);

CREATE INDEX IF NOT EXISTS idx_feed_user_seen_at
  ON feed_user_seen (seen_at);

CREATE TABLE IF NOT EXISTS feed_user_event (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'impression', 'dwell', 'open', 'bookmark', 'useful',
    'dismiss', 'mute_source', 'mute_topic', 'mute_author'
  )),
  dwell_ms INTEGER CHECK (dwell_ms IS NULL OR (dwell_ms >= 0 AND dwell_ms <= 600000)),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(meta) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feed_user_event_user_time
  ON feed_user_event (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_feed_user_event_created
  ON feed_user_event (created_at);

CREATE TABLE IF NOT EXISTS feed_user_affinity (
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  dim_type TEXT NOT NULL CHECK (dim_type IN ('topic', 'source', 'platform', 'author', 'community')),
  dim_key TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0,
  exposure_count INTEGER NOT NULL DEFAULT 0 CHECK (exposure_count >= 0),
  positive_count INTEGER NOT NULL DEFAULT 0 CHECK (positive_count >= 0),
  negative_count INTEGER NOT NULL DEFAULT 0 CHECK (negative_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, dim_type, dim_key)
);

CREATE INDEX IF NOT EXISTS idx_feed_user_affinity_rank
  ON feed_user_affinity (user_id, dim_type, weight DESC);

CREATE TABLE IF NOT EXISTS feed_user_preference (
  user_id UUID PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  explore_ratio REAL NOT NULL DEFAULT 0.20 CHECK (explore_ratio >= 0 AND explore_ratio <= 0.50),
  followed_topics TEXT[] NOT NULL DEFAULT '{}',
  muted_sources UUID[] NOT NULL DEFAULT '{}',
  muted_keywords TEXT[] NOT NULL DEFAULT '{}',
  muted_authors TEXT[] NOT NULL DEFAULT '{}',
  include_news_lane BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;
