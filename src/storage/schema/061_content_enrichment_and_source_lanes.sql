-- 061_content_enrichment_and_source_lanes.sql
-- Promote hot-path analytics & visual-card scalar columns on content,
-- store normalized author profile telemetry, classify source lanes,
-- archive passive news/marketing sources, and calibrate Reddit+X 20k/day budget ceilings.

BEGIN;

ALTER TABLE content
  ADD COLUMN IF NOT EXISTS author_handle TEXT,
  ADD COLUMN IF NOT EXISTS community_name TEXT,
  ADD COLUMN IF NOT EXISTS external_domain TEXT,
  ADD COLUMN IF NOT EXISTS hashtags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS has_media BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS primary_media_url TEXT,
  ADD COLUMN IF NOT EXISTS card_layout TEXT NOT NULL DEFAULT 'compact_signal',
  ADD COLUMN IF NOT EXISTS clean_excerpt TEXT,
  ADD COLUMN IF NOT EXISTS intent_tag TEXT,
  ADD COLUMN IF NOT EXISTS intent_confidence REAL,
  ADD COLUMN IF NOT EXISTS enrichment_version SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS enrichment_source TEXT NOT NULL DEFAULT 'heuristic_v1',
  ADD COLUMN IF NOT EXISTS metric_score INTEGER,
  ADD COLUMN IF NOT EXISTS metric_comments INTEGER,
  ADD COLUMN IF NOT EXISTS metric_views BIGINT,
  ADD COLUMN IF NOT EXISTS metric_likes INTEGER,
  ADD COLUMN IF NOT EXISTS metric_reposts INTEGER,
  ADD COLUMN IF NOT EXISTS metric_bookmarks INTEGER,
  ADD COLUMN IF NOT EXISTS upvote_ratio REAL,
  ADD COLUMN IF NOT EXISTS engagement_score REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discussion_ratio REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS velocity_score REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metrics_updated_at TIMESTAMPTZ;

ALTER TABLE content DROP CONSTRAINT IF EXISTS ck_content_card_layout;
ALTER TABLE content
  ADD CONSTRAINT ck_content_card_layout
  CHECK (card_layout IN ('hero_media', 'quote_social', 'discussion_thread', 'link_preview', 'compact_signal')) NOT VALID;

ALTER TABLE content DROP CONSTRAINT IF EXISTS ck_content_intent_tag;
ALTER TABLE content
  ADD CONSTRAINT ck_content_intent_tag
  CHECK (intent_tag IS NULL OR intent_tag IN ('discussion', 'question', 'comparison', 'pain', 'launch', 'news')) NOT VALID;

CREATE TABLE IF NOT EXISTS content_author_profile (
  platform_id UUID NOT NULL REFERENCES source(id),
  author_handle TEXT NOT NULL,
  author_external_id TEXT,
  display_name TEXT,
  avatar_url TEXT,
  bio TEXT,
  location TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  followers_count BIGINT,
  following_count BIGINT,
  statuses_count BIGINT,
  account_created_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metrics_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (platform_id, author_handle)
);

CREATE INDEX IF NOT EXISTS idx_content_author_profile_followers
  ON content_author_profile (platform_id, followers_count DESC NULLS LAST);

-- squawk-ignore require-concurrent-index-creation
CREATE INDEX IF NOT EXISTS idx_content_feed_hot
  ON content (engagement_score DESC, COALESCE(created_at_source, first_seen_at) DESC)
  WHERE availability = 'available';

-- squawk-ignore require-concurrent-index-creation
CREATE INDEX IF NOT EXISTS idx_content_community_time
  ON content (source_id, community_name, COALESCE(created_at_source, first_seen_at) DESC)
  WHERE community_name IS NOT NULL;

-- squawk-ignore require-concurrent-index-creation
CREATE INDEX IF NOT EXISTS idx_content_author_time
  ON content (source_id, author_handle, COALESCE(created_at_source, first_seen_at) DESC)
  WHERE author_handle IS NOT NULL;

-- squawk-ignore require-concurrent-index-creation
CREATE INDEX IF NOT EXISTS idx_content_domain
  ON content (external_domain)
  WHERE external_domain IS NOT NULL;

-- squawk-ignore require-concurrent-index-creation
CREATE INDEX IF NOT EXISTS idx_content_hashtags_gin
  ON content USING GIN (hashtags);

ALTER TABLE collection_source
  ADD COLUMN IF NOT EXISTS feed_lane TEXT NOT NULL DEFAULT 'discussion',
  ADD COLUMN IF NOT EXISTS quality_grade TEXT;

ALTER TABLE collection_source DROP CONSTRAINT IF EXISTS ck_collection_source_feed_lane;
ALTER TABLE collection_source
  ADD CONSTRAINT ck_collection_source_feed_lane
  CHECK (feed_lane IN ('discussion', 'release', 'monitor_only', 'news')) NOT VALID;

-- squawk-ignore require-concurrent-index-creation
CREATE INDEX IF NOT EXISTS idx_collection_source_lane
  ON collection_source (feed_lane, state);

UPDATE collection_source cs
SET
  feed_lane = 'release',
  updated_at = NOW()
WHERE cs.source_group = 'ai-firsthand'
  AND cs.feed_lane IS DISTINCT FROM 'release';

-- Archive existing passive news/lifestyle feeds & marketing hot lists (preserving FK integrity),
-- while leaving official AI release vendor sources untouched.
UPDATE collection_source cs
SET
  feed_lane = 'news',
  state = 'archived',
  schedule = jsonb_set(COALESCE(cs.schedule, '{}'::jsonb), '{enabled}', 'false'::jsonb, true),
  next_due_at = NULL,
  updated_at = NOW(),
  revision = cs.revision + 1
WHERE NOT EXISTS (SELECT 1 FROM ai_vendor_source avs WHERE avs.source_id = cs.id)
  AND (
    cs.source_group IN ('public-affairs', 'lifestyle', 'tech-media', 'design-visual', 'science')
    OR cs.label ~* '(v2ex|bilibili|zhihu|ithome|ifanr|cnbeta|technews|google\.com/trends|google-trends)'
    OR cs.target::text ~* '(v2ex|bilibili|zhihu|ithome|ifanr|cnbeta|technews\.tw|google-trends|trends\.google)'
  );

-- Calibrate Reddit + X provider ceiling to support up to 20k combined items/day without overriding enabled flag.
UPDATE source_provider_budget
SET
  daily_requests = GREATEST(daily_requests, 500),
  monthly_requests = GREATEST(monthly_requests, 15000),
  daily_resources = GREATEST(daily_resources, 10000),
  monthly_resources = GREATEST(monthly_resources, 300000),
  revision = revision + 1
WHERE provider IN ('kaix', 'red_crawler', 'twitterapis', 'scrapebadger');

-- Backfill promoted columns on existing content rows from canonical columns and latest observation.
UPDATE content c
SET
  author_handle = NULLIF(lower(btrim(c.content_author->>'handle')), ''),
  community_name = NULLIF(lower(btrim(c.platform_details->>'community')), ''),
  has_media = (jsonb_array_length(c.content_media) > 0),
  primary_media_url = COALESCE(
    (SELECT m->>'previewUrl' FROM jsonb_array_elements(c.content_media) m WHERE m->>'type' IN ('image', 'video') AND NULLIF(m->>'previewUrl', '') IS NOT NULL LIMIT 1),
    (SELECT m->>'url' FROM jsonb_array_elements(c.content_media) m WHERE m->>'type' IN ('image', 'video') AND NULLIF(m->>'url', '') IS NOT NULL LIMIT 1)
  ),
  external_domain = COALESCE(
    NULLIF(lower(c.platform_details->>'domain'), ''),
    NULLIF(lower(c.platform_details->>'externalDomain'), ''),
    NULLIF(lower(regexp_replace(c.url, '^https?://(?:www\.)?([^/?#]+).*$', '\1')), '')
  ),
  clean_excerpt = CASE
    WHEN c.body_text IS NULL THEN NULL
    ELSE left(btrim(regexp_replace(c.body_text, '\s+', ' ', 'g')), 220)
  END,
  metric_score = obs.score,
  metric_comments = obs.comments,
  metric_views = obs.views,
  metric_likes = obs.likes,
  metric_reposts = obs.reposts,
  metric_bookmarks = obs.bookmarks,
  upvote_ratio = obs.upvote_ratio,
  engagement_score = COALESCE(obs.engagement_score, 0),
  discussion_ratio = COALESCE(obs.discussion_ratio, 0),
  metrics_updated_at = COALESCE(obs.fetched_at, c.last_seen_at)
FROM (
  SELECT DISTINCT ON (o.content_id)
    o.content_id,
    o.fetched_at,
    NULLIF(o.metrics->>'reddit.score', '')::double precision::integer AS score,
    COALESCE(NULLIF(o.metrics->>'reddit.num_comments', '')::double precision::integer, NULLIF(o.metrics->>'x.replies', '')::double precision::integer) AS comments,
    NULLIF(o.metrics->>'x.views', '')::double precision::bigint AS views,
    NULLIF(o.metrics->>'x.likes', '')::double precision::integer AS likes,
    NULLIF(o.metrics->>'x.reposts', '')::double precision::integer AS reposts,
    NULLIF(o.metrics->>'x.bookmarks', '')::double precision::integer AS bookmarks,
    NULLIF(o.metrics->>'reddit.upvote_ratio', '')::real AS upvote_ratio,
    (
      ln(1 + GREATEST(0, COALESCE(NULLIF(o.metrics->>'reddit.score', '')::double precision, NULLIF(o.metrics->>'x.likes', '')::double precision, 0)))
      + 1.6 * ln(1 + GREATEST(0, COALESCE(NULLIF(o.metrics->>'reddit.num_comments', '')::double precision, NULLIF(o.metrics->>'x.replies', '')::double precision, 0)))
      + 0.8 * ln(1 + GREATEST(0, COALESCE(NULLIF(o.metrics->>'x.reposts', '')::double precision, 0)))
    )::real AS engagement_score,
    CASE
      WHEN COALESCE(NULLIF(o.metrics->>'reddit.score', '')::double precision, NULLIF(o.metrics->>'x.likes', '')::double precision, 0) > 0
      THEN (
        COALESCE(NULLIF(o.metrics->>'reddit.num_comments', '')::double precision, NULLIF(o.metrics->>'x.replies', '')::double precision, 0)
        / GREATEST(1, COALESCE(NULLIF(o.metrics->>'reddit.score', '')::double precision, NULLIF(o.metrics->>'x.likes', '')::double precision, 1))
      )::real
      ELSE 0
    END AS discussion_ratio
  FROM content_observation o
  ORDER BY o.content_id, o.source_observed_at DESC NULLS LAST, o.fetched_at DESC, o.id DESC
) obs
WHERE c.id = obs.content_id;

COMMIT;
