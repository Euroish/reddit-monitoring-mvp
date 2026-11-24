-- 067_collection_limits_and_tiers.sql
-- Raise single-run collection/comment/page limits (admin up to 10000 posts & 500 comments/post,
-- X multi-page up to 500 pages) and update tier batch defaults (free=2000, pro=5000).

BEGIN;

ALTER TABLE source_collection_job DROP CONSTRAINT IF EXISTS source_collection_job_page_size_check;
ALTER TABLE source_collection_job
  ADD CONSTRAINT source_collection_job_page_size_check
  CHECK (page_size IS NULL OR page_size BETWEEN 1 AND 10000) NOT VALID;

ALTER TABLE source_collection_job DROP CONSTRAINT IF EXISTS source_collection_job_max_pages_check;
ALTER TABLE source_collection_job
  ADD CONSTRAINT source_collection_job_max_pages_check
  CHECK (max_pages IS NULL OR max_pages BETWEEN 1 AND 500) NOT VALID;

ALTER TABLE plan_collection_policy DROP CONSTRAINT IF EXISTS plan_collection_policy_max_batch_limit_check;
ALTER TABLE plan_collection_policy
  ADD CONSTRAINT plan_collection_policy_max_batch_limit_check
  CHECK (max_batch_limit >= 1 AND max_batch_limit <= 10000) NOT VALID;

ALTER TABLE plan_collection_policy DROP CONSTRAINT IF EXISTS plan_collection_policy_max_comments_per_post_check;
ALTER TABLE plan_collection_policy
  ADD CONSTRAINT plan_collection_policy_max_comments_per_post_check
  CHECK (max_comments_per_post >= 0 AND max_comments_per_post <= 500) NOT VALID;

UPDATE plan_collection_policy
SET max_batch_limit = 2000,
    updated_at = NOW(),
    revision = revision + 1
WHERE plan_tier = 'free' AND max_batch_limit < 2000;

UPDATE plan_collection_policy
SET max_batch_limit = 5000,
    updated_at = NOW(),
    revision = revision + 1
WHERE plan_tier = 'pro' AND max_batch_limit < 5000;

COMMIT;
