-- Historical collection_job constraint cleanup.
-- Goal: remove legacy collection_job_status_check on already-migrated databases.

BEGIN;

ALTER TABLE collection_job
  DROP CONSTRAINT IF EXISTS collection_job_status_check;

DO $$
BEGIN
  ALTER TABLE collection_job
    ADD CONSTRAINT ck_collection_job_status
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'retrying', 'dead_letter'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

COMMIT;
