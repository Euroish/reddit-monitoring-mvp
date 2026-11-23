BEGIN;

-- Historical source rows do not reliably identify who provisioned them.
-- Existing sources remain operator-managed until individually reconciled.
ALTER TABLE collection_source
  ADD COLUMN monitor_managed BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
