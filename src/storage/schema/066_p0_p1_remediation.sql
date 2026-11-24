-- 066_p0_p1_remediation.sql
-- Consolidated forward schema for P0/P1 remediation:
-- - AUD-01: collection_source (usage_domain, feed_lane) consistency
-- - AUD-14: configurable source_global_budget ceiling & auto-hydration flag
-- - AUD-03/10: plan_collection_policy auto-schedule entitlements
-- - AUD-08/09/11: explicit monitor_project.visibility, fork provenance, private batch soft-discard
-- - AUD-06/10/14: intel_monitor project link, pause reason, schedule cursor, and daily usage ledger

BEGIN;

-- 1. AUD-01: Enforce valid (usage_domain, feed_lane) combinations on collection_source.
UPDATE collection_source
SET feed_lane = 'discussion',
    updated_at = NOW(),
    revision = revision + 1
WHERE usage_domain = 'feed' AND feed_lane = 'monitor_only';

ALTER TABLE collection_source DROP CONSTRAINT IF EXISTS ck_collection_source_domain_lane;
ALTER TABLE collection_source
  ADD CONSTRAINT ck_collection_source_domain_lane
  CHECK (NOT (usage_domain = 'feed' AND feed_lane = 'monitor_only')) NOT VALID;

-- 2. AUD-14: Configurable global daily social resource ceiling & automatic hydration switch.
CREATE TABLE IF NOT EXISTS source_global_budget (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  daily_social_item_ceiling INTEGER NOT NULL DEFAULT 20000 CHECK (daily_social_item_ceiling BETWEEN 0 AND 1000000),
  auto_hydration_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO source_global_budget (id, daily_social_item_ceiling, auto_hydration_enabled)
VALUES ('default', 20000, TRUE)
ON CONFLICT (id) DO NOTHING;

-- 3. AUD-03 / AUD-10: Plan-level continuous auto-schedule entitlements (fail-closed by default).
ALTER TABLE plan_collection_policy
  ADD COLUMN IF NOT EXISTS allow_auto_schedule BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS max_scheduled_tasks INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_schedule_interval_hours INTEGER NOT NULL DEFAULT 24;

ALTER TABLE plan_collection_policy DROP CONSTRAINT IF EXISTS ck_plan_collection_policy_max_scheduled_tasks;
ALTER TABLE plan_collection_policy
  ADD CONSTRAINT ck_plan_collection_policy_max_scheduled_tasks
  CHECK (max_scheduled_tasks BETWEEN 0 AND 100) NOT VALID;

ALTER TABLE plan_collection_policy DROP CONSTRAINT IF EXISTS ck_plan_collection_policy_min_interval;
ALTER TABLE plan_collection_policy
  ADD CONSTRAINT ck_plan_collection_policy_min_interval
  CHECK (min_schedule_interval_hours BETWEEN 1 AND 168) NOT VALID;

-- 4. AUD-11: Private batch soft-discard support without deleting canonical content.
ALTER TABLE collection_batch
  ADD COLUMN IF NOT EXISTS discarded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discarded_by_user_id UUID;

ALTER TABLE collection_batch DROP CONSTRAINT IF EXISTS fk_collection_batch_discarded_by;
ALTER TABLE collection_batch
  ADD CONSTRAINT fk_collection_batch_discarded_by
  FOREIGN KEY (discarded_by_user_id) REFERENCES app_user(id) ON DELETE SET NULL NOT VALID;

-- squawk-ignore require-concurrent-index-creation
CREATE INDEX IF NOT EXISTS idx_collection_batch_active_created
  ON collection_batch (collection_source_id, created_at DESC)
  WHERE discarded_at IS NULL;

-- 5. AUD-06 / AUD-08 / AUD-09: Explicit project visibility, fork source, and light monitor link.
ALTER TABLE monitor_project
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS forked_from_project_id UUID,
  ADD COLUMN IF NOT EXISTS linked_monitor_id UUID;

ALTER TABLE monitor_project DROP CONSTRAINT IF EXISTS ck_monitor_project_visibility;
ALTER TABLE monitor_project
  ADD CONSTRAINT ck_monitor_project_visibility
  CHECK (visibility IN ('private', 'shared')) NOT VALID;

ALTER TABLE monitor_project DROP CONSTRAINT IF EXISTS fk_monitor_project_forked_from;
ALTER TABLE monitor_project
  ADD CONSTRAINT fk_monitor_project_forked_from
  FOREIGN KEY (forked_from_project_id) REFERENCES monitor_project(id) ON DELETE SET NULL NOT VALID;

ALTER TABLE monitor_project DROP CONSTRAINT IF EXISTS fk_monitor_project_linked_monitor;
ALTER TABLE monitor_project
  ADD CONSTRAINT fk_monitor_project_linked_monitor
  FOREIGN KEY (linked_monitor_id) REFERENCES intel_monitor(id) ON DELETE SET NULL NOT VALID;

-- Preserve historical pre-066 staff-owned / system projects as shared so existing workspaces do not break on upgrade.
UPDATE monitor_project mp
SET visibility = 'shared'
WHERE mp.visibility = 'private'
  AND (
    mp.owner_user_id IS NULL
    OR EXISTS (
      SELECT 1 FROM app_user u
      WHERE u.id = mp.owner_user_id AND u.role IN ('owner', 'admin')
    )
  );

-- 6. AUD-06 / AUD-10 / AUD-14: Monitor project link, pause reason, schedule tracking, and daily usage ledger.
ALTER TABLE intel_monitor
  ADD COLUMN IF NOT EXISTS project_id UUID,
  ADD COLUMN IF NOT EXISTS paused_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_due_at TIMESTAMPTZ;

ALTER TABLE intel_monitor DROP CONSTRAINT IF EXISTS fk_intel_monitor_project;
ALTER TABLE intel_monitor
  ADD CONSTRAINT fk_intel_monitor_project
  FOREIGN KEY (project_id) REFERENCES monitor_project(id) ON DELETE SET NULL NOT VALID;

CREATE TABLE IF NOT EXISTS intel_monitor_usage (
  monitor_id UUID NOT NULL REFERENCES intel_monitor(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0 CHECK (requests >= 0),
  resources_reserved INTEGER NOT NULL DEFAULT 0 CHECK (resources_reserved >= 0),
  PRIMARY KEY (monitor_id, day)
);

COMMIT;
