-- Trend algorithm schema upgrade.
-- Goal: keep current write/read path compatible while enabling explainable scoring and algorithm experiments.

BEGIN;

ALTER TABLE subreddit_trend_point
  ADD COLUMN IF NOT EXISTS granularity snapshot_granularity_enum NOT NULL DEFAULT '15m',
  ADD COLUMN IF NOT EXISTS active_users INTEGER,
  ADD COLUMN IF NOT EXISTS subscribers INTEGER,
  ADD COLUMN IF NOT EXISTS velocity_score NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS acceleration_score NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS baseline_deviation_score NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS change_score NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS anomaly_score NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS algorithm_version TEXT NOT NULL DEFAULT 'trend_v1',
  ADD COLUMN IF NOT EXISTS algorithm_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS sample_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS window_complete BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS build_job_id UUID REFERENCES collection_job(id),
  ADD COLUMN IF NOT EXISTS score_components JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  ALTER TABLE subreddit_trend_point
    ADD CONSTRAINT ck_subreddit_trend_point_sample_count_non_negative
    CHECK (sample_count >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END$$;

CREATE INDEX IF NOT EXISTS idx_subreddit_trend_point_target_algo_window
  ON subreddit_trend_point (target_id, algorithm_version, window_start DESC);

CREATE INDEX IF NOT EXISTS idx_subreddit_trend_point_target_window_score
  ON subreddit_trend_point (target_id, window_start DESC, trend_score DESC);

-- Experiment table allows storing multiple algorithm versions for the same window
-- without changing the stable primary-key contract on subreddit_trend_point.
CREATE TABLE IF NOT EXISTS subreddit_trend_point_experiment (
  target_id UUID NOT NULL REFERENCES monitor_target(id),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  granularity snapshot_granularity_enum NOT NULL DEFAULT '15m',
  algorithm_version TEXT NOT NULL,
  new_posts INTEGER NOT NULL,
  active_users INTEGER,
  subscribers INTEGER,
  delta_new_posts_vs_prev_window INTEGER NOT NULL,
  delta_active_users_vs_prev_window INTEGER NOT NULL,
  velocity_score NUMERIC NOT NULL,
  acceleration_score NUMERIC NOT NULL,
  baseline_deviation_score NUMERIC NOT NULL,
  change_score NUMERIC NOT NULL,
  anomaly_score NUMERIC NOT NULL DEFAULT 0,
  trend_score NUMERIC NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  window_complete BOOLEAN NOT NULL DEFAULT TRUE,
  build_job_id UUID REFERENCES collection_job(id),
  algorithm_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  score_components JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (target_id, window_start, window_end, algorithm_version),
  CONSTRAINT ck_subreddit_trend_point_experiment_sample_count_non_negative
    CHECK (sample_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_subreddit_trend_exp_target_algo_window
  ON subreddit_trend_point_experiment (target_id, algorithm_version, window_start DESC);

CREATE INDEX IF NOT EXISTS idx_subreddit_trend_exp_algo_window_score
  ON subreddit_trend_point_experiment (algorithm_version, window_start DESC, trend_score DESC);

COMMIT;

