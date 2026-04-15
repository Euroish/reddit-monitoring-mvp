-- Collection job reliability upgrade.
-- Goal: add retry scheduling metadata and dead-letter state.

BEGIN;

ALTER TABLE collection_job
  ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ;

UPDATE collection_job
SET next_run_at = scheduled_at
WHERE next_run_at IS NULL;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    INNER JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'collection_job'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status IN%'
  LOOP
    EXECUTE format('ALTER TABLE collection_job DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;
END$$;

DO $$
BEGIN
  ALTER TABLE collection_job
    ADD CONSTRAINT ck_collection_job_status
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'retrying', 'dead_letter'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

CREATE INDEX IF NOT EXISTS idx_collection_job_status_next_run
  ON collection_job (status, next_run_at)
  WHERE status IN ('queued', 'retrying');

COMMIT;
