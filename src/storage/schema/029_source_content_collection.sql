BEGIN;

-- Keep the existing content identity/storage; target_id is the legacy single-target association.
ALTER TABLE content ALTER COLUMN target_id DROP NOT NULL;
ALTER TABLE content ALTER COLUMN title DROP NOT NULL;
ALTER TABLE content ALTER COLUMN permalink DROP NOT NULL;
ALTER TABLE content ALTER COLUMN created_at_source DROP NOT NULL;
ALTER TABLE content DROP CONSTRAINT IF EXISTS content_kind_check;
ALTER TABLE content ADD CONSTRAINT content_kind_check CHECK (kind IN ('post', 'comment', 'article', 'image', 'video'));
ALTER TABLE content DROP CONSTRAINT IF EXISTS content_source_id_external_id_key;
ALTER TABLE content ADD CONSTRAINT content_source_kind_external_key UNIQUE (source_id, kind, external_id);
ALTER TABLE content ADD COLUMN IF NOT EXISTS content_author JSONB;
ALTER TABLE content ADD COLUMN IF NOT EXISTS content_media JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE content ADD COLUMN IF NOT EXISTS content_references JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE content ADD COLUMN IF NOT EXISTS platform_details JSONB;
ALTER TABLE content ADD COLUMN IF NOT EXISTS language TEXT;
ALTER TABLE content ADD COLUMN IF NOT EXISTS availability TEXT NOT NULL DEFAULT 'unknown' CHECK (availability IN ('available','removed','deleted','unknown'));
ALTER TABLE content ADD COLUMN IF NOT EXISTS content_observed_at TIMESTAMPTZ;

CREATE TABLE collection_source (
  id UUID PRIMARY KEY,
  platform_id UUID NOT NULL REFERENCES source(id),
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  target JSONB NOT NULL CHECK (jsonb_typeof(target) = 'object'),
  content_kind TEXT NOT NULL CHECK (content_kind IN ('post','comment','article','image','video')),
  created_at TIMESTAMPTZ NOT NULL,
  last_success_at TIMESTAMPTZ,
  latest_published_at TIMESTAMPTZ,
  coverage TEXT NOT NULL DEFAULT 'unknown' CHECK (coverage IN ('unknown','partial')),
  UNIQUE (platform_id, provider, content_kind, target)
);
CREATE TABLE content_discovery (
  content_id UUID NOT NULL REFERENCES content(id),
  collection_source_id UUID NOT NULL REFERENCES collection_source(id),
  first_fetched_at TIMESTAMPTZ NOT NULL,
  last_fetched_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (content_id, collection_source_id)
);
CREATE INDEX idx_content_discovery_source ON content_discovery (collection_source_id, content_id);
CREATE TABLE content_observation (
  id BIGSERIAL PRIMARY KEY,
  content_id UUID NOT NULL REFERENCES content(id),
  collection_source_id UUID NOT NULL REFERENCES collection_source(id),
  provider TEXT NOT NULL,
  source_observed_at TIMESTAMPTZ,
  fetched_at TIMESTAMPTZ NOT NULL,
  time_basis TEXT NOT NULL CHECK (time_basis IN ('archive_initial','archive_refresh','provider_snapshot','unknown')),
  maturity TEXT NOT NULL CHECK (maturity IN ('initial','refreshed','unknown')),
  metrics JSONB NOT NULL CHECK (jsonb_typeof(metrics) = 'object'),
  evidence_key TEXT NOT NULL,
  UNIQUE (content_id, collection_source_id, evidence_key)
);
CREATE INDEX idx_content_observation_latest ON content_observation (content_id, collection_source_id, source_observed_at DESC NULLS LAST, fetched_at DESC);
CREATE TABLE source_collection_job (
  id UUID PRIMARY KEY,
  collection_source_id UUID NOT NULL REFERENCES collection_source(id),
  status TEXT NOT NULL CHECK (status IN ('queued','running','retrying','succeeded','failed')),
  from_at TIMESTAMPTZ NOT NULL,
  to_at TIMESTAMPTZ NOT NULL CHECK (to_at > from_at),
  page_size INTEGER NOT NULL CHECK (page_size BETWEEN 1 AND 100),
  max_pages INTEGER NOT NULL CHECK (max_pages BETWEEN 1 AND 20),
  pages_committed INTEGER NOT NULL DEFAULT 0,
  records_processed INTEGER NOT NULL DEFAULT 0,
  checkpoint JSONB,
  coverage TEXT NOT NULL DEFAULT 'unknown' CHECK (coverage IN ('unknown','partial')),
  exhausted BOOLEAN NOT NULL DEFAULT FALSE,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  next_run_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  lease_token UUID,
  lease_until TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_source_collection_active ON source_collection_job (collection_source_id) WHERE status IN ('queued','running','retrying');
CREATE INDEX idx_source_collection_runnable ON source_collection_job (next_run_at) WHERE status IN ('queued','running','retrying');
CREATE INDEX idx_content_public_time ON content (COALESCE(created_at_source, first_seen_at) DESC, id DESC);
COMMIT;
