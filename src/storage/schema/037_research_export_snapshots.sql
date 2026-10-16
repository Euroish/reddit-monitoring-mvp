BEGIN;

CREATE TABLE research_export (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  total INTEGER NOT NULL CHECK (total BETWEEN 0 AND 20000),
  manifest JSONB NOT NULL,
  payload_bytes INTEGER NOT NULL CHECK (payload_bytes BETWEEN 0 AND 33554432),
  created_at TIMESTAMPTZ NOT NULL,
  CHECK (manifest->>'formatVersion' = '1'),
  CHECK ((manifest->>'total')::INTEGER = total)
);
CREATE INDEX research_export_user_page_idx ON research_export(user_id, created_at DESC, id DESC);

CREATE TABLE research_export_member (
  export_id UUID NOT NULL REFERENCES research_export(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 20000),
  content_id TEXT NOT NULL,
  identity_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (export_id, ordinal),
  UNIQUE (export_id, content_id),
  UNIQUE (export_id, identity_key)
);
-- content_id deliberately has no live-content foreign key: an explicit frozen
-- sample survives later content deletion. Only export deletion removes members.

COMMIT;
