BEGIN;
-- Index only two-character runs. Keep the existing title/body offsets and
-- trigram document intact for phrase matching and rollback.
CREATE FUNCTION public_search_bigrams(document text) RETURNS text[]
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT ARRAY(
    SELECT DISTINCT pair[1]
    FROM regexp_split_to_table(regexp_replace(document, '([[:alnum:]])\1{2,}', '\1\1', 'g'), '[^[:alnum:]]+') AS words(word)
    CROSS JOIN (VALUES (1), (2)) AS offsets(pos)
    CROSS JOIN LATERAL regexp_matches(substring(word FROM pos), '..', 'g') AS pairs(pair)
  )
$$;
CREATE INDEX idx_content_search_bigram ON public_content_search_document
  USING gin (public_search_bigrams(search_text));

ALTER TABLE content ALTER COLUMN body_text SET COMPRESSION lz4;
ALTER TABLE content ALTER COLUMN platform_details SET COMPRESSION lz4;
ALTER TABLE public_content_search_document ALTER COLUMN search_text SET COMPRESSION lz4;
COMMIT;
