-- Add 6-hour granularity enum value for trend windows.

BEGIN;

DO $$
BEGIN
  ALTER TYPE snapshot_granularity_enum ADD VALUE IF NOT EXISTS '6h';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

COMMIT;
