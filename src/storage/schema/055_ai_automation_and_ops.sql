-- 055_ai_automation_and_ops.sql
-- AI Release Intelligence Automation & Low-Ops Upgrade:
-- - Official vendor domain allowlists & per-vendor gradual auto-publish switches
-- - Artificial Analysis v2 real endpoint & license redistribution boundary
-- - Per-source due scheduling (next_run_at / backoff_seconds)
-- - 3 lightweight ops tables: ai_llm_extraction_cache, ai_auto_publish_audit, ai_ops_alert
-- Adds +3 tables (total public tables: 41).

BEGIN;

ALTER TABLE ai_vendor
  ADD COLUMN IF NOT EXISTS official_domains JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_publish_enabled BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE ai_vendor SET official_domains = '["openai.com","platform.openai.com","help.openai.com"]'::jsonb WHERE slug = 'openai';
UPDATE ai_vendor SET official_domains = '["anthropic.com","docs.anthropic.com","www.anthropic.com"]'::jsonb WHERE slug = 'anthropic';
UPDATE ai_vendor SET official_domains = '["blog.google","deepmind.google","ai.google.dev","developers.googleblog.com"]'::jsonb WHERE slug = 'google';
UPDATE ai_vendor SET official_domains = '["ai.meta.com","about.fb.com","llama.com"]'::jsonb WHERE slug = 'meta';
UPDATE ai_vendor SET official_domains = '["deepseek.com","api-docs.deepseek.com","www.deepseek.com"]'::jsonb WHERE slug = 'deepseek';
UPDATE ai_vendor SET official_domains = '["qwen.ai","qwenlm.github.io","help.aliyun.com"]'::jsonb WHERE slug = 'qwen';
UPDATE ai_vendor SET official_domains = '["moonshot.cn","moonshot.ai","platform.moonshot.cn"]'::jsonb WHERE slug = 'moonshot';
UPDATE ai_vendor SET official_domains = '["z.ai","zhipuai.cn","bigmodel.cn","docs.bigmodel.cn"]'::jsonb WHERE slug = 'zai';
UPDATE ai_vendor SET official_domains = '["mistral.ai","docs.mistral.ai"]'::jsonb WHERE slug = 'mistral';
UPDATE ai_vendor SET official_domains = '["x.ai","docs.x.ai"]'::jsonb WHERE slug = 'xai';

ALTER TABLE ai_registry_source
  ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS backoff_seconds INTEGER NOT NULL DEFAULT 0 CHECK (backoff_seconds >= 0);

UPDATE ai_registry_source
SET endpoint_url = 'https://artificialanalysis.ai/api/v2/language/models/free',
    config = config || '{"commercialUrl":"https://artificialanalysis.ai/api/v2/language/models","freeUrl":"https://artificialanalysis.ai/api/v2/language/models/free","requiresCommercialLicenseForPublic":true}'::jsonb,
    updated_at = NOW()
WHERE code = 'artificial_analysis';

INSERT INTO ai_registry_source (code, kind, label, endpoint_url, enabled, sync_interval_seconds, config)
VALUES (
  'official_discovery',
  'official_feed',
  'Official Blog / Changelog / Release Notes Discovery',
  'internal://content/ai-firsthand',
  TRUE,
  1800,
  '{"lookbackHours":168}'::jsonb
)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE ai_benchmark_snapshot
  ADD COLUMN IF NOT EXISTS license_tier TEXT NOT NULL DEFAULT 'free_internal'
    CHECK (license_tier IN ('free_internal', 'commercial_public')),
  ADD COLUMN IF NOT EXISTS public_redistribution_allowed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_ai_bench_snap_public
  ON ai_benchmark_snapshot(public_redistribution_allowed, category, captured_at DESC);

CREATE TABLE IF NOT EXISTS ai_llm_extraction_cache (
  content_hash TEXT PRIMARY KEY CHECK (length(content_hash) BETWEEN 16 AND 128),
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL DEFAULT 'v1',
  extracted_payload JSONB NOT NULL,
  valid BOOLEAN NOT NULL DEFAULT TRUE,
  error_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_llm_cache_created ON ai_llm_extraction_cache(created_at DESC);

CREATE TABLE IF NOT EXISTS ai_auto_publish_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL CHECK (mode IN ('auto_publish', 'shadow_pass', 'shadow_reject', 'auto_rollback', 'manual_rollback', 'low_value_archived')),
  vendor_id UUID REFERENCES ai_vendor(id) ON DELETE SET NULL,
  event_id UUID REFERENCES ai_release_event(id) ON DELETE SET NULL,
  candidate_id UUID REFERENCES ai_event_candidate(id) ON DELETE SET NULL,
  content_id UUID REFERENCES content(id) ON DELETE SET NULL,
  confidence NUMERIC(4, 3),
  rule_name TEXT NOT NULL,
  reason TEXT,
  evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_auto_audit_created ON ai_auto_publish_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_auto_audit_mode ON ai_auto_publish_audit(mode, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_ops_alert (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  source_code TEXT,
  alert_key TEXT NOT NULL,
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_ops_alert_open ON ai_ops_alert(resolved_at, created_at DESC);

COMMIT;
