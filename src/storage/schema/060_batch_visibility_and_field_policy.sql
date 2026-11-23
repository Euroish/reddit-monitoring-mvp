ALTER TABLE collection_batch
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'collection_batch_visibility_check'
  ) THEN
    ALTER TABLE collection_batch
      ADD CONSTRAINT collection_batch_visibility_check
      CHECK (visibility IN ('private', 'shared')) NOT VALID;
    ALTER TABLE collection_batch
      VALIDATE CONSTRAINT collection_batch_visibility_check;
  END IF;
END $$;

UPDATE collection_batch cb
SET visibility = 'shared'
WHERE cb.visibility = 'private'
  AND (
    cb.created_by_user_id IS NULL
    OR EXISTS (
      SELECT 1 FROM app_user u
      WHERE u.id = cb.created_by_user_id AND u.role IN ('owner', 'admin')
    )
  );

ALTER TABLE plan_collection_policy
  ADD COLUMN IF NOT EXISTS max_lookback_days INTEGER NOT NULL DEFAULT 7;

ALTER TABLE plan_collection_policy
  ADD COLUMN IF NOT EXISTS allow_provider_choice BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE plan_collection_policy
SET max_lookback_days = 30,
    allow_provider_choice = TRUE
WHERE plan_tier = 'pro' AND max_lookback_days = 7;

ALTER TABLE collection_source
  ADD COLUMN IF NOT EXISTS usage_domain TEXT NOT NULL DEFAULT 'research';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'collection_source_usage_domain_check'
  ) THEN
    ALTER TABLE collection_source
      ADD CONSTRAINT collection_source_usage_domain_check
      CHECK (usage_domain IN ('research', 'feed')) NOT VALID;
    ALTER TABLE collection_source
      VALIDATE CONSTRAINT collection_source_usage_domain_check;
  END IF;
END $$;

UPDATE collection_source cs
SET usage_domain = 'feed'
FROM source p
WHERE cs.platform_id = p.id AND p.code = 'web' AND cs.usage_domain = 'research';
