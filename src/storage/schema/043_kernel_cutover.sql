BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM source_collection_job WHERE status='running' OR status IN ('queued','retrying') AND page_request_attempts>0) THEN
    RAISE EXCEPTION 'Stop internal test workers and reconcile in-flight jobs before kernel cutover';
  END IF;
END $$;
UPDATE source_collection_job SET status='cancelled',finished_at=NOW(),lease_token=NULL,lease_until=NULL,error='Retired internal test queue at kernel cutover'
WHERE status IN ('queued','retrying');
ALTER TABLE app_session ADD COLUMN client_kind TEXT NOT NULL DEFAULT 'browser' CHECK (client_kind IN ('browser','machine'));
ALTER TABLE app_session ADD COLUMN label TEXT;
ALTER TABLE app_session ADD COLUMN scopes TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE app_session ADD COLUMN allowed_source_ids UUID[];
ALTER TABLE collection_source ADD COLUMN primary_provider TEXT;
UPDATE collection_source SET primary_provider=provider;
ALTER TABLE collection_source ALTER COLUMN primary_provider SET NOT NULL;
ALTER TABLE collection_source ADD COLUMN fallback_provider TEXT;
ALTER TABLE collection_source ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'pull' CHECK (delivery_mode IN ('pull','push'));
ALTER TABLE collection_source ADD COLUMN http_etag TEXT;
ALTER TABLE collection_source ADD COLUMN http_last_modified TEXT;
ALTER TABLE source_collection_job ADD COLUMN operation TEXT NOT NULL DEFAULT 'radar' CHECK (operation IN ('radar','hydrate','ingest'));
ALTER TABLE source_collection_job ADD COLUMN provider TEXT;
UPDATE source_collection_job j SET provider=cs.primary_provider FROM collection_source cs WHERE cs.id=j.collection_source_id;
ALTER TABLE source_collection_job ALTER COLUMN provider SET NOT NULL;
ALTER TABLE source_collection_job ADD COLUMN provider_state JSONB NOT NULL DEFAULT '{}';
ALTER TABLE source_collection_job ADD COLUMN request_key TEXT;
ALTER TABLE source_collection_job ADD COLUMN request_json JSONB NOT NULL DEFAULT '{}';
ALTER TABLE source_collection_job ADD COLUMN ingest_key TEXT;
ALTER TABLE source_collection_job ADD COLUMN payload_hash TEXT;
ALTER TABLE source_collection_job ADD COLUMN result_summary JSONB;
ALTER TABLE source_collection_job ADD COLUMN fallback_of_job_id UUID REFERENCES source_collection_job(id);
ALTER TABLE source_collection_job ALTER COLUMN from_at DROP NOT NULL;
ALTER TABLE source_collection_job ALTER COLUMN to_at DROP NOT NULL;
ALTER TABLE source_collection_job ALTER COLUMN page_size DROP NOT NULL;
ALTER TABLE source_collection_job ALTER COLUMN max_pages DROP NOT NULL;
ALTER TABLE source_collection_job DROP CONSTRAINT source_collection_job_page_size_check;
ALTER TABLE source_collection_job ADD CHECK (page_size IS NULL OR page_size BETWEEN 1 AND 2000);
ALTER TABLE source_collection_job DROP CONSTRAINT source_collection_job_purpose_check;
ALTER TABLE source_collection_job ADD CHECK (purpose IN ('manual','scheduled','refresh','recheck','collect','ingest'));
ALTER TABLE source_collection_job ADD CHECK (purpose='ingest' OR (from_at IS NOT NULL AND to_at IS NOT NULL AND page_size IS NOT NULL AND max_pages IS NOT NULL));
CREATE UNIQUE INDEX uq_source_ingest_key ON source_collection_job(collection_source_id,ingest_key) WHERE ingest_key IS NOT NULL;
DROP INDEX uq_source_collection_active;
CREATE UNIQUE INDEX uq_source_collection_active ON source_collection_job(collection_source_id) WHERE status IN ('queued','running','retrying') AND purpose<>'ingest';

INSERT INTO source_provider_budget(provider,enabled,daily_requests,monthly_requests,daily_resources,monthly_resources)
VALUES ('arctic_shift',FALSE,0,0,0,0),('twitterapi_io',FALSE,0,0,0,0)
ON CONFLICT(provider) DO UPDATE SET enabled=FALSE,daily_requests=0,monthly_requests=0,daily_resources=0,monthly_resources=0,revision=source_provider_budget.revision+1;
INSERT INTO source_provider_budget(provider,enabled,daily_requests,monthly_requests,daily_resources,monthly_resources)
VALUES ('kaix',FALSE,0,0,0,0),('red_crawler',FALSE,0,0,0,0),('twitterapis',FALSE,0,0,0,0),('scrapebadger',FALSE,0,0,0,0),('bluesky_appview',FALSE,0,0,0,0)
ON CONFLICT DO NOTHING;
UPDATE source_collection_job SET status='cancelled',finished_at=NOW(),lease_token=NULL,lease_until=NULL,error='Provider retired'
WHERE provider IN ('arctic_shift','twitterapi_io') AND status IN ('queued','retrying');
UPDATE collection_source SET state='archived',next_due_at=NULL,next_recheck_at=NULL,schedule=schedule||'{"enabled":false}',refresh=refresh||'{"enabled":false}',revision=revision+1
WHERE primary_provider IN ('arctic_shift','twitterapi_io');

INSERT INTO source(id,code,name) VALUES('44444444-4444-4444-4444-444444444444','web','Web') ON CONFLICT(code) DO NOTHING;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER TABLE public_content_search_document ADD COLUMN search_text TEXT;
ALTER TABLE public_content_search_document ADD COLUMN title_length INTEGER;
UPDATE public_content_search_document d SET
  search_text=CASE WHEN c.availability IN ('deleted','removed') THEN chr(31) ELSE
    btrim(regexp_replace(lower(normalize(COALESCE(c.title,''),NFKC)),'[[:space:]]+',' ','g'))||chr(31)||
    btrim(regexp_replace(lower(normalize(COALESCE(c.body_text,''),NFKC)),'[[:space:]]+',' ','g')) END,
  title_length=CASE WHEN c.availability IN ('deleted','removed') THEN 0 ELSE char_length(btrim(regexp_replace(lower(normalize(COALESCE(c.title,''),NFKC)),'[[:space:]]+',' ','g'))) END
FROM content c WHERE c.id=d.content_id;
INSERT INTO public_content_search_document(content_id,format_version,normalized_title,normalized_text,text_present,indexed_at,fingerprint,search_text,title_length)
SELECT c.id,1,'','',c.body_text IS NOT NULL,NOW(),repeat('0',64),
  btrim(regexp_replace(lower(normalize(CASE WHEN c.availability IN ('deleted','removed') THEN '' ELSE COALESCE(c.title,'') END,NFKC)),'[[:space:]]+',' ','g'))||chr(31)||
  btrim(regexp_replace(lower(normalize(CASE WHEN c.availability IN ('deleted','removed') THEN '' ELSE COALESCE(c.body_text,'') END,NFKC)),'[[:space:]]+',' ','g')),
  char_length(btrim(regexp_replace(lower(normalize(CASE WHEN c.availability IN ('deleted','removed') THEN '' ELSE COALESCE(c.title,'') END,NFKC)),'[[:space:]]+',' ','g')))
FROM content c WHERE NOT EXISTS (SELECT 1 FROM public_content_search_document d WHERE d.content_id=c.id);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM content c LEFT JOIN public_content_search_document d ON d.content_id=c.id WHERE d.search_text IS NULL OR d.title_length IS NULL) THEN
    RAISE EXCEPTION 'Search projection backfill incomplete';
  END IF;
END $$;
ALTER TABLE public_content_search_document ALTER COLUMN search_text SET NOT NULL;
ALTER TABLE public_content_search_document ALTER COLUMN title_length SET NOT NULL;
DROP TRIGGER invalidate_public_content_search_document ON content;
DROP FUNCTION invalidate_public_content_search_document();
ALTER TABLE public_content_search_document DROP COLUMN normalized_title, DROP COLUMN normalized_text;
CREATE INDEX idx_content_search_trgm ON public_content_search_document USING GIN (search_text gin_trgm_ops);
COMMIT;
