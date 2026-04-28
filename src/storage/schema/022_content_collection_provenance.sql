BEGIN;

ALTER TABLE content
  ADD COLUMN IF NOT EXISTS discovery_source TEXT NOT NULL DEFAULT 'new_listing',
  ADD COLUMN IF NOT EXISTS first_collection_mode TEXT,
  ADD COLUMN IF NOT EXISTS first_listing TEXT,
  ADD COLUMN IF NOT EXISTS first_time_range TEXT,
  ADD COLUMN IF NOT EXISTS first_collection_job_id UUID REFERENCES collection_job(id),
  ADD COLUMN IF NOT EXISTS total_eligible BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE content
  DROP CONSTRAINT IF EXISTS ck_content_discovery_source;

ALTER TABLE content
  ADD CONSTRAINT ck_content_discovery_source
    CHECK (discovery_source IN ('new_listing', 'top_supplement', 'unknown'));

ALTER TABLE content
  DROP CONSTRAINT IF EXISTS ck_content_first_collection_mode;

ALTER TABLE content
  ADD CONSTRAINT ck_content_first_collection_mode
    CHECK (
      first_collection_mode IS NULL
      OR first_collection_mode IN ('live', 'backfill')
    );

ALTER TABLE content
  DROP CONSTRAINT IF EXISTS ck_content_first_listing;

ALTER TABLE content
  ADD CONSTRAINT ck_content_first_listing
    CHECK (
      first_listing IS NULL
      OR first_listing IN ('new', 'top', 'unknown')
    );

CREATE INDEX IF NOT EXISTS idx_content_target_total_eligible_created
  ON content (target_id, total_eligible, created_at_source);

COMMIT;
