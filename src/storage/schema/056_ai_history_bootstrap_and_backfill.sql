-- 056_ai_history_bootstrap_and_backfill.sql
-- Versioned AI history seed import ledger and resumable backfill cursor tracking.
-- Adds +2 tables (total public tables: 43).
-- Never modifies 001..055 applied migrations.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_history_import_run (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_version TEXT NOT NULL,
  dataset_sha256 TEXT NOT NULL,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('startup', 'manual', 'dry_run', 'reconcile')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'skipped_unchanged', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  inserted_models INTEGER NOT NULL DEFAULT 0,
  inserted_aliases INTEGER NOT NULL DEFAULT 0,
  inserted_events INTEGER NOT NULL DEFAULT 0,
  matched_events INTEGER NOT NULL DEFAULT 0,
  skipped_events INTEGER NOT NULL DEFAULT 0,
  conflicts INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  source_branch_commit TEXT,
  summary_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_ai_history_import_dataset ON ai_history_import_run(dataset_version, started_at DESC);

CREATE TABLE IF NOT EXISTS ai_history_backfill_run (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_code TEXT NOT NULL,
  vendor_slug TEXT,
  date_from DATE,
  date_to DATE,
  status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'succeeded', 'failed')),
  cursor_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  scanned_count INTEGER NOT NULL DEFAULT 0,
  published_count INTEGER NOT NULL DEFAULT 0,
  candidates_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_history_backfill_source ON ai_history_backfill_run(source_code, started_at DESC);

COMMIT;
