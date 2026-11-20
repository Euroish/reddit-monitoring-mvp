BEGIN;

ALTER TABLE app_user
  ADD COLUMN IF NOT EXISTS quota_override JSONB DEFAULT NULL;

ALTER TABLE source_collection_job
  ADD COLUMN IF NOT EXISTS requested_by_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requested_by_client_kind TEXT CHECK (requested_by_client_kind IN ('browser', 'machine'));

CREATE INDEX IF NOT EXISTS idx_source_collection_job_requester
  ON source_collection_job (requested_by_user_id, created_at DESC)
  WHERE requested_by_user_id IS NOT NULL;

ALTER TABLE source_provider_credential
  DROP CONSTRAINT IF EXISTS source_provider_credential_provider_check;

ALTER TABLE source_provider_credential
  ADD CONSTRAINT source_provider_credential_provider_check
  CHECK (provider IN ('apify', 'kaix', 'red_crawler', 'twitterapis', 'scrapebadger'));

CREATE TABLE IF NOT EXISTS plan_collection_policy (
  plan_tier TEXT PRIMARY KEY CHECK (plan_tier IN ('free', 'pro')),
  manual_collect_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_providers TEXT[] NOT NULL DEFAULT '{}',
  allowed_source_ids UUID[] DEFAULT NULL,
  daily_requests INTEGER CHECK (daily_requests IS NULL OR daily_requests >= 0),
  daily_resources INTEGER CHECK (daily_resources IS NULL OR daily_resources >= 0),
  max_batch_limit INTEGER NOT NULL DEFAULT 20 CHECK (max_batch_limit >= 1 AND max_batch_limit <= 2000),
  max_comments_per_post INTEGER NOT NULL DEFAULT 0 CHECK (max_comments_per_post >= 0 AND max_comments_per_post <= 50),
  updated_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
);

INSERT INTO plan_collection_policy (
  plan_tier, manual_collect_enabled, allowed_providers, allowed_source_ids,
  daily_requests, daily_resources, max_batch_limit, max_comments_per_post
) VALUES
  ('free', FALSE, '{}', NULL, 0, 0, 20, 0),
  ('pro', FALSE, '{}', NULL, 0, 0, 20, 0)
ON CONFLICT (plan_tier) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_provider_usage (
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  day DATE NOT NULL,
  requests_reserved INTEGER NOT NULL DEFAULT 0 CHECK (requests_reserved >= 0),
  requests_executed INTEGER NOT NULL DEFAULT 0 CHECK (requests_executed >= 0),
  resources_reserved INTEGER NOT NULL DEFAULT 0 CHECK (resources_reserved >= 0),
  PRIMARY KEY (user_id, provider, day)
);

COMMIT;
