BEGIN;

DELETE FROM metrics_snapshot
WHERE content_id IS NOT NULL;

DROP INDEX IF EXISTS uq_metrics_snapshot_content_level;

ALTER TABLE metrics_snapshot
  DROP CONSTRAINT IF EXISTS ck_metrics_snapshot_scope;

ALTER TABLE metrics_snapshot
  ADD CONSTRAINT ck_metrics_snapshot_scope
    CHECK (
      metric_name IN ('subscribers', 'active_users', 'new_posts_15m')
      AND content_id IS NULL
    );

COMMIT;
