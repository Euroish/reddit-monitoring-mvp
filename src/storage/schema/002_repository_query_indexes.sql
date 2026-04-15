-- Read-path indexes aligned with current PostgreSQL repositories.
-- Scope: Reddit-only MVP query patterns (no schema shape changes).

BEGIN;

CREATE INDEX IF NOT EXISTS idx_monitor_target_source_type_status_canonical
  ON monitor_target (source_id, target_type, status, canonical_name);

CREATE INDEX IF NOT EXISTS idx_content_target_created_at_source_desc
  ON content (target_id, created_at_source DESC);

CREATE INDEX IF NOT EXISTS idx_metrics_snapshot_target_metric_snapshot_at
  ON metrics_snapshot (target_id, metric_name, snapshot_at);

COMMIT;
