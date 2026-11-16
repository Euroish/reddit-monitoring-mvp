BEGIN;

ALTER TABLE content ADD COLUMN content_evidence_key TEXT COLLATE "C" NOT NULL DEFAULT '';
ALTER TABLE content ADD COLUMN content_version_fetched_at TIMESTAMPTZ;
UPDATE content SET content_version_fetched_at = last_seen_at;
ALTER TABLE content ALTER COLUMN content_version_fetched_at SET NOT NULL;

-- Legacy writers remain usable during the cutover; their evidence is explicitly unknown.
ALTER TABLE content ALTER COLUMN content_version_fetched_at SET DEFAULT NOW();
DO $$
DECLARE old_unique TEXT;
BEGIN
  SELECT conname INTO STRICT old_unique FROM pg_constraint
  WHERE conrelid='content_observation'::regclass AND contype='u'
    AND pg_get_constraintdef(oid)='UNIQUE (content_id, collection_source_id, evidence_key)';
  EXECUTE format('ALTER TABLE content_observation DROP CONSTRAINT %I', old_unique);
END $$;
ALTER TABLE content_observation ADD CONSTRAINT content_observation_provider_evidence_key
  UNIQUE (content_id, collection_source_id, provider, evidence_key);
ALTER TABLE content_observation ADD COLUMN payload_hash TEXT;
ALTER TABLE content_observation ADD CONSTRAINT content_observation_payload_hash_check
  CHECK (payload_hash IS NULL OR payload_hash ~ '^[a-f0-9]{64}$');

CREATE INDEX idx_content_published_keyset ON content (created_at_source DESC NULLS LAST, id DESC);
CREATE INDEX idx_content_reference_nodes ON content USING GIN (content_references jsonb_path_ops);
COMMIT;
