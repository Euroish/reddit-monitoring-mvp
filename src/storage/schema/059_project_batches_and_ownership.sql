ALTER TABLE monitor_project
  ADD COLUMN IF NOT EXISTS dataset_mode TEXT NOT NULL DEFAULT 'source_filter';

ALTER TABLE monitor_project
  ADD COLUMN IF NOT EXISTS description TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'monitor_project_dataset_mode_check'
  ) THEN
    ALTER TABLE monitor_project
      ADD CONSTRAINT monitor_project_dataset_mode_check
      CHECK (dataset_mode IN ('source_filter', 'batch')) NOT VALID;
    ALTER TABLE monitor_project
      VALIDATE CONSTRAINT monitor_project_dataset_mode_check;
  END IF;
END $$;

ALTER TABLE plan_collection_policy
  ADD COLUMN IF NOT EXISTS max_projects INTEGER NOT NULL DEFAULT 3;

ALTER TABLE plan_collection_policy
  ADD COLUMN IF NOT EXISTS export_enabled BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE plan_collection_policy
SET max_projects = 20
WHERE plan_tier = 'pro' AND max_projects = 3;

CREATE TABLE IF NOT EXISTS collection_batch (
  id UUID PRIMARY KEY,
  job_id UUID UNIQUE REFERENCES source_collection_job(id) ON DELETE SET NULL,
  collection_source_id UUID NOT NULL REFERENCES collection_source(id) ON DELETE RESTRICT,
  created_by_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_batch_source_created
  ON collection_batch (collection_source_id, created_at DESC);

CREATE TABLE IF NOT EXISTS collection_batch_item (
  batch_id UUID NOT NULL REFERENCES collection_batch(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  PRIMARY KEY (batch_id, content_id)
);

CREATE INDEX IF NOT EXISTS idx_collection_batch_item_content
  ON collection_batch_item (content_id);

CREATE TABLE IF NOT EXISTS monitor_project_batch (
  project_id UUID NOT NULL REFERENCES monitor_project(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES collection_batch(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled', 'removed')),
  added_by_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (project_id, batch_id)
);

CREATE INDEX IF NOT EXISTS idx_monitor_project_batch_project_status
  ON monitor_project_batch (project_id, status);
