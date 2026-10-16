BEGIN;
CREATE TABLE content_saved_query (
  id UUID PRIMARY KEY,user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(char_length(name) BETWEEN 1 AND 100),query JSONB NOT NULL CHECK(jsonb_typeof(query)='object'),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX content_saved_query_own_page ON content_saved_query(user_id,updated_at DESC,id DESC);
CREATE TABLE content_annotation (
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  favorite BOOLEAN NOT NULL DEFAULT FALSE,note TEXT NOT NULL DEFAULT '' CHECK(char_length(note)<=2000),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1),created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(user_id,content_id)
);
CREATE INDEX content_annotation_own_page ON content_annotation(user_id,updated_at DESC,content_id DESC);
CREATE INDEX content_annotation_favorite_page ON content_annotation(user_id,updated_at DESC,content_id DESC) WHERE favorite;
COMMIT;
