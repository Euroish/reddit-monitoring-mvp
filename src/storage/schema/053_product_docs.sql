BEGIN;

-- Product documentation center: one row per document page.
-- 053 is the 24th live table, which is the hard ceiling (<= 24).
CREATE TABLE IF NOT EXISTS doc_page (
  id           UUID PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  category     TEXT NOT NULL CHECK (category IN ('feature', 'terms', 'notice')),
  title        TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  summary      TEXT NOT NULL DEFAULT '' CHECK (char_length(summary) <= 400),
  kind         TEXT NOT NULL DEFAULT 'markdown' CHECK (kind IN ('markdown', 'link', 'file')),
  body_md      TEXT NOT NULL DEFAULT '',
  external_url TEXT,
  file_name    TEXT,
  file_mime    TEXT,
  file_bytes   BYTEA,
  pinned       BOOLEAN NOT NULL DEFAULT FALSE,
  sort_rank    INTEGER NOT NULL DEFAULT 100 CHECK (sort_rank BETWEEN 0 AND 9999),
  status       TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published')),
  revision     INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_by   UUID REFERENCES app_user(id) ON DELETE SET NULL,
  updated_by   UUID REFERENCES app_user(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT doc_page_payload_check CHECK (
    kind = 'markdown'
    OR (kind = 'link' AND external_url IS NOT NULL AND char_length(external_url) <= 2048)
    OR (kind = 'file' AND file_name IS NOT NULL AND file_bytes IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_doc_page_listing
  ON doc_page (pinned DESC, sort_rank ASC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_doc_page_category
  ON doc_page (category, status);

COMMIT;
