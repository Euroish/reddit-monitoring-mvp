-- 054_ai_release_intelligence.sql
-- AI Product Release Calendar, Model Catalog, Dual-Track Registry Diff,
-- Evidence-Backed Review Queue, and Licensed Benchmark Snapshots.
-- Adds 14 normalized tables (total public tables: 38).
-- Never modifies 001..053 applied migrations.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_vendor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9_-]{0,47}$'),
  name TEXT NOT NULL,
  website_url TEXT NOT NULL,
  logo_url TEXT,
  official_orgs JSONB NOT NULL DEFAULT '[]'::jsonb,
  display_order INTEGER NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_vendor_source (
  vendor_id UUID NOT NULL REFERENCES ai_vendor(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES collection_source(id) ON DELETE CASCADE,
  is_official BOOLEAN NOT NULL DEFAULT TRUE,
  source_role TEXT NOT NULL DEFAULT 'blog' CHECK (source_role IN ('blog', 'changelog', 'docs', 'release_notes', 'model_card', 'other')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (vendor_id, source_id)
);

CREATE TABLE IF NOT EXISTS ai_model (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES ai_vendor(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9._-]{0,95}$'),
  family TEXT,
  official_name TEXT NOT NULL,
  official_api_id TEXT,
  model_kind TEXT NOT NULL DEFAULT 'llm' CHECK (model_kind IN ('llm', 'reasoning', 'multimodal', 'image', 'video', 'audio', 'embedding', 'code', 'other')),
  lifecycle_state TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle_state IN ('announced', 'preview', 'active', 'deprecated', 'retired', 'unknown')),
  open_weights BOOLEAN,
  license_name TEXT,
  modalities JSONB NOT NULL DEFAULT '[]'::jsonb,
  context_window INTEGER CHECK (context_window IS NULL OR context_window > 0),
  summary_zh TEXT,
  summary_en TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_model_vendor ON ai_model(vendor_id, lifecycle_state);

CREATE TABLE IF NOT EXISTS ai_model_alias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES ai_model(id) ON DELETE CASCADE,
  source_namespace TEXT NOT NULL CHECK (source_namespace IN ('official', 'openrouter', 'litellm', 'hf', 'epoch', 'artificial_analysis', 'manual')),
  alias TEXT NOT NULL CHECK (length(alias) BETWEEN 1 AND 256),
  review_status TEXT NOT NULL DEFAULT 'verified' CHECK (review_status IN ('pending', 'verified', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_namespace, alias)
);
CREATE INDEX IF NOT EXISTS idx_ai_model_alias_model ON ai_model_alias(model_id);

CREATE TABLE IF NOT EXISTS ai_registry_source (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9_-]{0,47}$'),
  kind TEXT NOT NULL CHECK (kind IN ('openrouter', 'litellm', 'hf', 'epoch', 'artificial_analysis', 'official_feed')),
  label TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sync_interval_seconds INTEGER NOT NULL DEFAULT 7200 CHECK (sync_interval_seconds BETWEEN 300 AND 604800),
  etag TEXT,
  last_blob_sha TEXT,
  watermark TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  circuit_open_until TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_registry_listing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_source_id UUID NOT NULL REFERENCES ai_registry_source(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL CHECK (length(external_id) BETWEEN 1 AND 256),
  route_variant TEXT NOT NULL DEFAULT 'default' CHECK (length(route_variant) BETWEEN 1 AND 128),
  model_id UUID REFERENCES ai_model(id) ON DELETE SET NULL,
  vendor_slug_hint TEXT,
  display_name TEXT,
  active_state TEXT NOT NULL DEFAULT 'active' CHECK (active_state IN ('active', 'missing_once', 'missing_confirmed', 'inactive')),
  missing_streak INTEGER NOT NULL DEFAULT 0,
  registry_created_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  content_hash TEXT NOT NULL,
  normalized_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (registry_source_id, external_id, route_variant)
);
CREATE INDEX IF NOT EXISTS idx_ai_registry_listing_model ON ai_registry_listing(model_id);
CREATE INDEX IF NOT EXISTS idx_ai_registry_listing_active ON ai_registry_listing(registry_source_id, active_state);

CREATE TABLE IF NOT EXISTS ai_registry_change (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_source_id UUID NOT NULL REFERENCES ai_registry_source(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES ai_registry_listing(id) ON DELETE SET NULL,
  external_id TEXT NOT NULL,
  route_variant TEXT NOT NULL DEFAULT 'default',
  change_type TEXT NOT NULL CHECK (change_type IN ('new_listing', 'spec_change', 'pricing_change', 'listing_missing', 'listing_restored')),
  change_hash TEXT NOT NULL,
  previous_value JSONB,
  current_value JSONB,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (registry_source_id, external_id, route_variant, change_type, change_hash)
);
CREATE INDEX IF NOT EXISTS idx_ai_registry_change_observed ON ai_registry_change(observed_at DESC);

CREATE TABLE IF NOT EXISTS ai_model_spec_observation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID REFERENCES ai_model(id) ON DELETE CASCADE,
  listing_id UUID REFERENCES ai_registry_listing(id) ON DELETE SET NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('official', 'openrouter', 'litellm', 'hf', 'epoch', 'manual')),
  provider_name TEXT,
  context_length INTEGER,
  max_output_tokens INTEGER,
  input_modalities JSONB NOT NULL DEFAULT '[]'::jsonb,
  output_modalities JSONB NOT NULL DEFAULT '[]'::jsonb,
  currency TEXT NOT NULL DEFAULT 'USD',
  price_unit TEXT NOT NULL DEFAULT 'per_1m_tokens' CHECK (price_unit IN ('per_token', 'per_1k_tokens', 'per_1m_tokens', 'per_request', 'other')),
  input_price NUMERIC(18, 8),
  output_price NUMERIC(18, 8),
  cache_read_price NUMERIC(18, 8),
  raw_unit_note TEXT,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  effective_until TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ai_spec_obs_model ON ai_model_spec_observation(model_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS ai_event_candidate (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key TEXT NOT NULL UNIQUE CHECK (length(dedupe_key) BETWEEN 1 AND 256),
  candidate_type TEXT NOT NULL CHECK (candidate_type IN ('new_listing', 'spec_change', 'pricing_observation', 'official_document', 'release_event', 'historical_import', 'listing_missing')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'needs_info', 'approved', 'rejected', 'merged', 'deferred')),
  priority INTEGER NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  vendor_id UUID REFERENCES ai_vendor(id) ON DELETE SET NULL,
  model_id UUID REFERENCES ai_model(id) ON DELETE SET NULL,
  registry_change_id UUID REFERENCES ai_registry_change(id) ON DELETE SET NULL,
  content_id UUID REFERENCES content(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  external_id TEXT,
  suggested_event_type TEXT CHECK (suggested_event_type IS NULL OR suggested_event_type IN ('model_release', 'model_update', 'api_release', 'preview', 'ga', 'pricing_change', 'deprecation', 'retirement', 'other')),
  suggested_date DATE,
  date_precision TEXT NOT NULL DEFAULT 'unknown' CHECK (date_precision IN ('day', 'month', 'unknown')),
  draft_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_payload JSONB NOT NULL DEFAULT '[]'::jsonb,
  llm_meta JSONB,
  has_conflict BOOLEAN NOT NULL DEFAULT FALSE,
  merged_into_candidate_id UUID REFERENCES ai_event_candidate(id) ON DELETE SET NULL,
  published_event_id UUID,
  reviewer_note TEXT,
  reviewed_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_candidate_status ON ai_event_candidate(status, priority DESC, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_candidate_vendor ON ai_event_candidate(vendor_id, status);

CREATE TABLE IF NOT EXISTS ai_release_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES ai_vendor(id) ON DELETE RESTRICT,
  model_id UUID REFERENCES ai_model(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('model_release', 'model_update', 'api_release', 'preview', 'ga', 'pricing_change', 'deprecation', 'retirement', 'other')),
  event_status TEXT NOT NULL DEFAULT 'released' CHECK (event_status IN ('released', 'announced_future', 'deprecated', 'retired')),
  publication_status TEXT NOT NULL DEFAULT 'published' CHECK (publication_status IN ('published', 'unpublished', 'corrected')),
  title TEXT NOT NULL,
  event_date DATE NOT NULL,
  date_precision TEXT NOT NULL DEFAULT 'day' CHECK (date_precision IN ('day', 'month')),
  official_announced_on DATE,
  available_from DATE,
  effective_on DATE,
  summary_zh TEXT,
  summary_en TEXT,
  key_changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_tier TEXT NOT NULL DEFAULT 'official' CHECK (source_tier IN ('official', 'historical_verified', 'manual_verified')),
  dedupe_key TEXT UNIQUE,
  verified_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_release_event_pub_date ON ai_release_event(publication_status, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_release_event_vendor_date ON ai_release_event(vendor_id, event_date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_release_event_model ON ai_release_event(model_id, event_date ASC);

CREATE TABLE IF NOT EXISTS ai_event_reference (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES ai_release_event(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES ai_event_candidate(id) ON DELETE CASCADE,
  content_id UUID REFERENCES content(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  title TEXT,
  source_kind TEXT NOT NULL DEFAULT 'official' CHECK (source_kind IN ('official', 'changelog', 'model_card', 'epoch', 'registry', 'other')),
  article_published_at TIMESTAMPTZ,
  excerpt TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (event_id IS NOT NULL OR candidate_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_ai_event_ref_event ON ai_event_reference(event_id);
CREATE INDEX IF NOT EXISTS idx_ai_event_ref_candidate ON ai_event_reference(candidate_id);

CREATE TABLE IF NOT EXISTS ai_sync_run (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_source_id UUID REFERENCES ai_registry_source(id) ON DELETE SET NULL,
  source_code TEXT NOT NULL,
  trigger_kind TEXT NOT NULL DEFAULT 'scheduled' CHECK (trigger_kind IN ('scheduled', 'manual', 'dry_run')),
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'partial_failed', 'failed', 'cancelled')),
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  changed_count INTEGER NOT NULL DEFAULT 0,
  candidates_created INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER,
  error_code TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ai_sync_run_source ON ai_sync_run(source_code, started_at DESC);

CREATE TABLE IF NOT EXISTS ai_benchmark_snapshot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_code TEXT NOT NULL CHECK (provider_code IN ('artificial_analysis', 'manual_licensed')),
  category TEXT NOT NULL CHECK (category IN ('general', 'coding', 'reasoning', 'speed_price')),
  metric_name TEXT NOT NULL,
  metric_version TEXT NOT NULL,
  metric_direction TEXT NOT NULL DEFAULT 'higher' CHECK (metric_direction IN ('higher', 'lower')),
  unit TEXT,
  attribution_text TEXT NOT NULL,
  attribution_url TEXT NOT NULL,
  license_note TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_bench_snapshot_cat ON ai_benchmark_snapshot(category, captured_at DESC);

CREATE TABLE IF NOT EXISTS ai_benchmark_entry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES ai_benchmark_snapshot(id) ON DELETE CASCADE,
  model_id UUID REFERENCES ai_model(id) ON DELETE SET NULL,
  external_model_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  vendor_name TEXT,
  score NUMERIC(14, 4) NOT NULL,
  rank INTEGER NOT NULL CHECK (rank >= 1),
  sample_note TEXT,
  provider_setting TEXT,
  extra_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (snapshot_id, external_model_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_bench_entry_rank ON ai_benchmark_entry(snapshot_id, rank ASC);

-- Seed 10 core official AI vendors (idempotent)
INSERT INTO ai_vendor (slug, name, website_url, official_orgs, display_order) VALUES
  ('openai', 'OpenAI', 'https://openai.com', '["openai"]'::jsonb, 10),
  ('anthropic', 'Anthropic', 'https://www.anthropic.com', '["anthropic"]'::jsonb, 20),
  ('google', 'Google / DeepMind', 'https://deepmind.google', '["google", "google-deepmind"]'::jsonb, 30),
  ('meta', 'Meta AI', 'https://ai.meta.com', '["meta-llama"]'::jsonb, 40),
  ('deepseek', 'DeepSeek', 'https://www.deepseek.com', '["deepseek-ai"]'::jsonb, 50),
  ('qwen', 'Qwen (Alibaba)', 'https://qwenlm.github.io', '["Qwen"]'::jsonb, 60),
  ('moonshot', 'Moonshot / Kimi', 'https://www.moonshot.cn', '["moonshotai"]'::jsonb, 70),
  ('zai', 'Z.ai (Zhipu)', 'https://z.ai', '["THUDM", "zai-org"]'::jsonb, 80),
  ('mistral', 'Mistral AI', 'https://mistral.ai', '["mistralai"]'::jsonb, 90),
  ('xai', 'xAI', 'https://x.ai', '["xai-org"]'::jsonb, 100)
ON CONFLICT (slug) DO NOTHING;

-- Seed default structured registry & benchmark sources (idempotent)
INSERT INTO ai_registry_source (code, kind, label, endpoint_url, enabled, sync_interval_seconds, config) VALUES
  ('openrouter', 'openrouter', 'OpenRouter Models API', 'https://openrouter.ai/api/v1/models', TRUE, 7200, '{"maxBytes": 10485760}'::jsonb),
  ('litellm', 'litellm', 'LiteLLM Model Cost Map', 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json', TRUE, 7200, '{"maxBytes": 15728640}'::jsonb),
  ('huggingface', 'hf', 'Hugging Face Official Orgs', 'https://huggingface.co/api/models', TRUE, 7200, '{"orgs": ["openai", "meta-llama", "deepseek-ai", "Qwen", "mistralai", "google", "moonshotai", "zai-org"], "limitPerOrg": 15}'::jsonb),
  ('epoch', 'epoch', 'Epoch AI Notable Models CSV', 'https://epoch.ai/data/notable_ai_models.csv', FALSE, 604800, '{"mode": "manual_import_only"}'::jsonb),
  ('artificial_analysis', 'artificial_analysis', 'Artificial Analysis Data API', 'https://artificialanalysis.ai/api/v2/data/llms/models', FALSE, 86400, '{"requiresApiKey": true}'::jsonb)
ON CONFLICT (code) DO NOTHING;

COMMIT;
