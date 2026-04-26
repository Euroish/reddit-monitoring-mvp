BEGIN;

ALTER TABLE crawl_cursor
  ADD COLUMN IF NOT EXISTS backfill_target_from_iso TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS backfill_coverage_status TEXT
    CHECK (
      backfill_coverage_status IN (
        'missing',
        'progressing',
        'covered',
        'source_limited',
        'saturated_before_15d'
      )
    ),
  ADD COLUMN IF NOT EXISTS backfill_stop_reason TEXT
    CHECK (
      backfill_stop_reason IN (
        'awaiting_progress',
        'coverage_reached',
        'terminal_eof',
        'cursor_saturated',
        'iteration_budget_exhausted'
      )
    );

COMMIT;
