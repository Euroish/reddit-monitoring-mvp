BEGIN;
CREATE TABLE monitor_project (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  filter JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(filter)='object'),
  hydration JSONB NOT NULL DEFAULT '{"enabled":false}',
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision>=1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE monitor_project_source (
  project_id UUID NOT NULL REFERENCES monitor_project(id) ON DELETE CASCADE,
  collection_source_id UUID NOT NULL REFERENCES collection_source(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id,collection_source_id)
);
COMMIT;
