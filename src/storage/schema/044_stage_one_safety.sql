BEGIN;
-- Restore the rollback projection without rewriting the applied cutover checksum.
ALTER TABLE public_content_search_document ADD COLUMN normalized_title TEXT NOT NULL DEFAULT '';
ALTER TABLE public_content_search_document ADD COLUMN normalized_text TEXT NOT NULL DEFAULT '';
UPDATE public_content_search_document SET
  normalized_title=left(search_text,title_length),
  normalized_text=substring(search_text FROM title_length+2);
ALTER TABLE monitor_project ADD COLUMN owner_user_id UUID REFERENCES app_user(id);
ALTER TABLE monitor_project ADD COLUMN thread_aware BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE monitor_project ADD COLUMN include_push_in_trends BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE source_collection_job ADD COLUMN provider_run_id TEXT;
UPDATE source_collection_job SET provider_run_id=provider_state->>'runId';
CREATE UNIQUE INDEX uq_source_collect_request_key ON source_collection_job(collection_source_id,request_key) WHERE purpose='collect';
UPDATE app_session SET scopes=ARRAY(SELECT DISTINCT CASE scope
  WHEN 'content:read' THEN 'read' WHEN 'sources:read' THEN 'read' WHEN 'projects:read' THEN 'read'
  WHEN 'content:export' THEN 'export' WHEN 'content:ingest' THEN 'ingest' WHEN 'collection:run' THEN 'collect'
  ELSE scope END FROM unnest(scopes) scope);
COMMIT;
