BEGIN;
ALTER TABLE collection_source ADD COLUMN automatic_collection_blocked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE source_collection_job ADD COLUMN failure_kind TEXT CHECK(failure_kind IN ('transient','permanent'));
ALTER TABLE source_collection_job ADD COLUMN refresh_attempt_started_at TIMESTAMPTZ;
ALTER TABLE source_collection_job ADD COLUMN page_request_attempts INTEGER NOT NULL DEFAULT 0 CHECK(page_request_attempts>=0);
-- Historic terminal failures have no durable retryability evidence. Preserve their
-- checkpoint/history, and require explicit Retry if the latest job still failed.
UPDATE source_collection_job SET failure_kind='permanent' WHERE status='failed';
UPDATE collection_source cs SET automatic_collection_blocked=TRUE
WHERE (SELECT j.status FROM source_collection_job j WHERE j.collection_source_id=cs.id ORDER BY j.created_at DESC,j.id DESC LIMIT 1)='failed';
COMMIT;
