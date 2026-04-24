BEGIN;

CREATE TABLE IF NOT EXISTS saved_workbench_view (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  view_kind TEXT NOT NULL CHECK (view_kind IN ('target', 'comparison')),
  primary_target TEXT NOT NULL,
  compare_targets TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  keywords TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  series_ids TEXT[] NOT NULL DEFAULT ARRAY[]::text[],
  route_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS saved_workbench_view_user_updated_idx
  ON saved_workbench_view(user_id, updated_at DESC);

COMMIT;
