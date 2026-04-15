# Data Model (Reddit-only MVP)

## Modeling decisions

- Keep product model source-agnostic.
- Keep Reddit payload in raw storage for replay/remapping.
- Use append-only snapshots for trend change.
- Start with `subreddit` target type only.

## Logical tables

## `source`
Purpose: source registry.

Core fields:
- `id` (uuid, pk)
- `code` (`reddit`)
- `name`
- `created_at`

## `monitor_target`
Purpose: what to monitor.

Core fields:
- `id` (uuid, pk)
- `source_id` (fk -> source.id)
- `target_type` (`subreddit`)
- `external_id` (nullable, e.g. Reddit fullname `t5_*`)
- `canonical_name` (e.g. `r/machinelearning`)
- `status` (`active|paused`)
- `config_json` (jsonb; polling config/filters)
- `created_at`
- `updated_at`

Constraints:
- unique (`source_id`, `target_type`, `canonical_name`)

## `account`
Purpose: normalized author/profile.

Core fields:
- `id` (uuid, pk)
- `source_id` (fk)
- `external_id` (e.g. `t2_*`)
- `username`
- `is_deleted` (bool)
- `created_at_source` (nullable)
- `first_seen_at`
- `last_seen_at`

Constraints:
- unique (`source_id`, `external_id`)

## `content`
Purpose: normalized content (Phase 1: post only).

Core fields:
- `id` (uuid, pk)
- `source_id` (fk)
- `target_id` (fk -> monitor_target.id)
- `account_id` (nullable fk -> account.id)
- `external_id` (e.g. `t3_*`)
- `kind` (`post`)
- `title`
- `body_text` (nullable)
- `url` (nullable)
- `permalink`
- `created_at_source`
- `first_seen_at`
- `last_seen_at`

Constraints:
- unique (`source_id`, `external_id`)

## `metrics_snapshot`
Purpose: append-only metric observations for trends.

Core fields:
- `id` (bigserial, pk)
- `snapshot_at` (timestamptz)
- `source_id` (fk)
- `target_id` (fk)
- `content_id` (nullable fk)
- `granularity` (`15m|1h|1d`)
- `metric_name`
- `metric_value` (numeric)
- `collection_job_id` (fk)
- `created_at`

Example `metric_name` values:
- target-level: `subscribers`, `active_users`, `new_posts_15m`
- content-level: `score`, `num_comments`, `upvote_ratio`

Constraints:
- unique (`target_id`, `content_id`, `granularity`, `metric_name`, `snapshot_at`)
- implementation note: when `content_id` is nullable, use two partial unique indexes
  - target-level (`content_id IS NULL`)
  - content-level (`content_id IS NOT NULL`)

Constraint note:
- enforce `metric_name` as PostgreSQL enum (`metric_name_enum`) to avoid name drift
- enforce metric scope check:
  - target-level metrics (`subscribers`, `active_users`, `new_posts_15m`) require `content_id IS NULL`
  - content-level metrics (`score`, `num_comments`, `upvote_ratio`) require `content_id IS NOT NULL`

## `raw_reddit_event`
Purpose: raw request/response archive for audit/replay.

Core fields:
- `id` (bigserial, pk)
- `collection_job_id` (fk)
- `target_id` (fk)
- `endpoint`
- `request_params` (jsonb)
- `http_status`
- `response_headers` (jsonb)
- `payload` (jsonb)
- `fetched_at`

## `collection_job`
Purpose: async job state and resumability.

Core fields:
- `id` (uuid, pk)
- `source_id` (fk)
- `target_id` (fk)
- `job_type`
- `status` (`queued|running|succeeded|failed|retrying`)
- `scheduled_at`
- `started_at` (nullable)
- `finished_at` (nullable)
- `cursor` (nullable)
- `dedupe_key`
- `retry_count`
- `error_message` (nullable)

Constraints:
- unique (`job_type`, `target_id`, `dedupe_key`)

## Derived read model (optional table or materialized view)

## `subreddit_trend_point`
Purpose: API-friendly timeline row.

Core fields:
- `target_id`
- `window_start`
- `window_end`
- `granularity` (`15m|1h|1d`)
- `new_posts`
- `active_users` (nullable)
- `subscribers` (nullable)
- `delta_new_posts_vs_prev_window`
- `delta_active_users_vs_prev_window`
- `velocity_score`
- `acceleration_score`
- `baseline_deviation_score`
- `change_score`
- `anomaly_score`
- `trend_score`
- `algorithm_version` (default `trend_v1`)
- `algorithm_params` (jsonb)
- `sample_count`
- `window_complete`
- `build_job_id` (nullable fk -> `collection_job.id`)
- `score_components` (jsonb for explain/debug)

This can be built on-demand from `metrics_snapshot` first, then materialized later if needed.

## `subreddit_trend_point_experiment`
Purpose: store multiple algorithm-version outputs for the same timeline window, without changing stable primary-key behavior of `subreddit_trend_point`.

Core fields:
- `target_id`
- `window_start`
- `window_end`
- `granularity`
- `algorithm_version`
- `new_posts`
- `active_users` (nullable)
- `subscribers` (nullable)
- `delta_new_posts_vs_prev_window`
- `delta_active_users_vs_prev_window`
- `velocity_score`
- `acceleration_score`
- `baseline_deviation_score`
- `change_score`
- `anomaly_score`
- `trend_score`
- `sample_count`
- `window_complete`
- `build_job_id` (nullable)
- `algorithm_params` (jsonb)
- `score_components` (jsonb)
- `created_at`
