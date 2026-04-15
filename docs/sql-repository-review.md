# SQL Repository Review (Phase 1)

Date: 2026-04-10

## Scope

Reviewed:
- `src/storage/schema/001_reddit_mvp_init.sql`
- `src/storage/repositories/postgres/*.ts`

Focus:
- repository query shape vs existing indexes/constraints
- idempotency and conflict behavior
- window-range reads used by trend aggregation

## Findings

1. `monitor_target` canonical-name lookup did not constrain `target_type`.
- Impact: query shape was not fully aligned with the unique key `(source_id, target_type, canonical_name)`.
- Fix: repository query now includes `target_type = 'subreddit'`.

2. `content` recent-by-target read path had no dedicated sort index.
- Impact: `ORDER BY created_at_source DESC LIMIT n` can degrade into larger scans as content volume grows.
- Fix: added index `idx_content_target_created_at_source_desc`.

3. `metrics_snapshot` trend-range read path had no dedicated `(target_id, metric_name, snapshot_at)` index.
- Impact: trend aggregation reads can scan extra rows under larger snapshot volume.
- Fix: added index `idx_metrics_snapshot_target_metric_snapshot_at`.

4. active subreddit listing benefits from explicit status/canonical index.
- Impact: predictable read behavior for worker target scan as monitor list grows.
- Fix: added index `idx_monitor_target_source_type_status_canonical`.

## Applied changes

- Code:
  - `src/storage/repositories/postgres/postgres-monitor-target.repository.ts`
  - `src/storage/repositories/postgres/postgres-account.repository.ts`
  - `src/storage/repositories/postgres/postgres-content.repository.ts`
  - `src/storage/repositories/postgres/postgres-metrics-snapshot.repository.ts`
  - `src/storage/repositories/postgres/postgres-subreddit-trend-point.repository.ts`
  - `src/storage/repositories/postgres/postgres-sql.utils.ts`
- Migration:
  - `src/storage/schema/002_repository_query_indexes.sql`

## Performance hardening (2026-04-10 update)

- Repositories moved from row-by-row SQL writes to chunked batch writes inside one transaction.
- Batch inputs are deduplicated by business key before SQL execution to avoid redundant conflict work.
- This reduces DB round-trips on each phase-1 run while preserving idempotent conflict semantics.

## Notes

- No schema contract change (tables/types/constraints unchanged).
- No repository API change.
- Existing migration checksum policy is preserved by adding a new numbered migration instead of editing `001`.
