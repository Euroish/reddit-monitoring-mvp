BEGIN;
ALTER TABLE source_collection_job ADD COLUMN request_count INTEGER NOT NULL DEFAULT 0 CHECK(request_count>=0);
ALTER TABLE source_collection_job ADD COLUMN request_duration_ms DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK(request_duration_ms>=0);
COMMIT;
