BEGIN;
ALTER TABLE collection_source ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1);
ALTER TABLE source_provider_budget ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1);
ALTER TABLE monitor_target ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1);
COMMIT;
