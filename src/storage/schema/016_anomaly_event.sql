-- Additive R4 base table for raw anomaly signals used by anomaly feeds and later incident merging.

BEGIN;

DO $$
BEGIN
  CREATE TYPE anomaly_signal_type_enum AS ENUM ('volume', 'quality', 'keyword', 'driver');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

CREATE TABLE IF NOT EXISTS anomaly_event (
  target_id UUID NOT NULL REFERENCES monitor_target(id),
  signal_type anomaly_signal_type_enum NOT NULL,
  signal_key TEXT NOT NULL DEFAULT '',
  observed_at TIMESTAMPTZ NOT NULL,
  window_start TIMESTAMPTZ NULL,
  window_end TIMESTAMPTZ NULL,
  anomaly_score NUMERIC NOT NULL DEFAULT 0,
  algorithm_version TEXT NOT NULL DEFAULT 'anomaly_event_v1',
  explain_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (target_id, signal_type, signal_key, observed_at),
  CONSTRAINT ck_anomaly_event_non_negative_score
    CHECK (anomaly_score >= 0),
  CONSTRAINT ck_anomaly_event_window_bounds
    CHECK (window_start IS NULL OR window_end IS NULL OR window_start <= window_end)
);

CREATE INDEX IF NOT EXISTS idx_anomaly_event_target_observed
  ON anomaly_event (target_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_anomaly_event_target_signal_observed
  ON anomaly_event (target_id, signal_type, observed_at DESC);

COMMIT;
