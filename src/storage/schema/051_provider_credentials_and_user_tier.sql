BEGIN;

ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS plan_tier TEXT NOT NULL DEFAULT 'free'
    CHECK (plan_tier IN ('free', 'pro'));

CREATE TABLE IF NOT EXISTS source_provider_credential (
  provider TEXT PRIMARY KEY CHECK (
    provider IN ('kaix', 'red_crawler', 'twitterapis', 'scrapebadger')
  ),
  encrypted_secret TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  updated_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

COMMIT;
