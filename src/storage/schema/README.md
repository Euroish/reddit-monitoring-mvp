# Schema Migrations

- `001_reddit_mvp_init.sql` is the baseline PostgreSQL migration for Reddit-only MVP.
- `002_repository_query_indexes.sql` adds read-path indexes for active target lookup, recent content reads, and metrics trend-range reads.
- `003_trend_algorithm_upgrade.sql` extends trend scoring schema with explainable components and an experiment table for multi-version scoring output.
- `004_collection_job_reliability.sql` adds retry scheduling metadata and dead-letter state for collection jobs.
- `005_macro_trend_scores.sql` adds macro trend score fields for trend board read models.
- `metrics_snapshot` uses two partial unique indexes to correctly dedupe target-level rows when `content_id` is `NULL`.
- `006_add_6h_granularity.sql` extends `snapshot_granularity_enum` with `6h` for six-hour trend points.
- `007_keyword_trend_daily.sql` adds daily keyword mention materialization with mention-rate fields.
- `008_keyword_query_session_and_search_docs.sql` adds `post_search_document`, `keyword_query_session`, and `keyword_query_sample_post` for Keyword Pulse queries.
- `009_crawl_cursor_and_provider_health_window.sql` adds `crawl_cursor` (provider+target+mode incremental cursor with rewind) and `provider_health_window` (provider quality evidence buckets).
- `010_queue_observability_upgrade.sql` adds `collection_job.crawl_mode` for live/backfill queue splits and extends `provider_health_window` with duplicate/lag/provider-diff observability counters.
- `011_keyword_pulse_point_5m_and_query_cache.sql` adds `keyword_pulse_point_5m`, extends `keyword_query_sample_post` with `source_type`/`data_quality`, and adds a cache lookup index for reusable keyword sessions.
- `012_collection_job_payload.sql` adds `collection_job.payload` so durable queue dispatch can preserve request-scoped execution hints such as post-limit overrides.
- `020_saved_workbench_view.sql` adds user-owned saved workbench contexts for target/comparison workflows.
- `metric_name` is enforced by PostgreSQL enum (`metric_name_enum`) and scope check:
  - target-level metrics require `content_id IS NULL`
  - content-level metrics require `content_id IS NOT NULL`
- Keep enum/check values synchronized with domain unions in `src/domain/entities`.
