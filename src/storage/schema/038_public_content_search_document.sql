BEGIN;
CREATE TABLE public_content_search_document (
  content_id UUID PRIMARY KEY REFERENCES content(id) ON DELETE CASCADE,
  format_version INTEGER NOT NULL CHECK(format_version=1),normalized_title TEXT NOT NULL,normalized_text TEXT NOT NULL,
  text_present BOOLEAN NOT NULL,indexed_at TIMESTAMPTZ NOT NULL,fingerprint TEXT NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$')
);
-- An out-of-path canonical change makes coverage visibly incomplete until an
-- explicit backfill. Normal page commits rebuild this row in their transaction.
CREATE FUNCTION invalidate_public_content_search_document() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public_content_search_document WHERE content_id=NEW.id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invalidate_public_content_search_document AFTER UPDATE OF title,body_text,platform_details ON content
FOR EACH ROW WHEN (OLD.title IS DISTINCT FROM NEW.title OR OLD.body_text IS DISTINCT FROM NEW.body_text OR NEW.platform_details IS NULL)
EXECUTE FUNCTION invalidate_public_content_search_document();
COMMIT;
