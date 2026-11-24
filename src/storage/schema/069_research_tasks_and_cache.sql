-- Migration 069: Research L2 cache & L3 on-demand task orchestration tables

CREATE TABLE IF NOT EXISTS intel_research_task (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES monitor_project(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES app_user(id) ON DELETE SET NULL,
  task_type TEXT NOT NULL CHECK (task_type IN ('sentiment', 'topic_modeling')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  scope_hash TEXT NOT NULL,
  scope_json JSONB NOT NULL,
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_version TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  sample_limit INTEGER NOT NULL DEFAULT 5000 CHECK (sample_limit BETWEEN 1 AND 20000),
  sample_count INTEGER NOT NULL DEFAULT 0 CHECK (sample_count >= 0),
  progress_pct INTEGER NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  progress_stage TEXT NOT NULL DEFAULT 'queued',
  summary_json JSONB,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intel_research_task_project_created
  ON intel_research_task (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_intel_research_task_status
  ON intel_research_task (status, created_at ASC)
  WHERE status IN ('queued', 'running');

CREATE TABLE IF NOT EXISTS intel_research_task_item (
  task_id UUID NOT NULL REFERENCES intel_research_task(id) ON DELETE CASCADE,
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  sentiment_label TEXT CHECK (
    sentiment_label IS NULL OR sentiment_label IN ('positive', 'neutral', 'negative', 'unclassified')
  ),
  sentiment_score DOUBLE PRECISION,
  topic_index INTEGER CHECK (topic_index IS NULL OR topic_index >= 0),
  topic_score DOUBLE PRECISION,
  PRIMARY KEY (task_id, content_id)
);

CREATE INDEX IF NOT EXISTS idx_intel_research_task_item_sentiment
  ON intel_research_task_item (task_id, sentiment_label)
  WHERE sentiment_label IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_intel_research_task_item_topic
  ON intel_research_task_item (task_id, topic_index)
  WHERE topic_index IS NOT NULL;

CREATE TABLE IF NOT EXISTS intel_research_cache (
  cache_key TEXT PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES monitor_project(id) ON DELETE CASCADE,
  layer TEXT NOT NULL CHECK (layer IN ('l1', 'l2')),
  actor_scope_hash TEXT NOT NULL,
  data_version TEXT NOT NULL,
  scope_hash TEXT NOT NULL,
  lang TEXT NOT NULL CHECK (lang IN ('zh', 'en')),
  payload_json JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_intel_research_cache_project_ver
  ON intel_research_cache (project_id, layer, data_version);

CREATE INDEX IF NOT EXISTS idx_intel_research_cache_expires
  ON intel_research_cache (expires_at);
