BEGIN;
-- Multiple hydration requests can wait on the same source. The existing
-- running-job index still allows only one leased job per source.
DROP INDEX uq_source_collection_active;
CREATE UNIQUE INDEX uq_source_collection_active ON source_collection_job(collection_source_id)
  WHERE status IN ('queued','running','retrying') AND purpose<>'ingest' AND operation<>'hydrate';
CREATE INDEX idx_source_collection_pending ON source_collection_job(collection_source_id,created_at,id)
  WHERE status IN ('queued','running','retrying');
COMMIT;
