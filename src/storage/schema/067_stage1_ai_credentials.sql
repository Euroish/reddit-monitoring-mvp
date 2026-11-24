CREATE TABLE IF NOT EXISTS ai_provider_credential (
  provider TEXT PRIMARY KEY CHECK (
    provider IN ('artificial_analysis', 'ai_llm', 'openrouter')
  ),
  encrypted_secret TEXT NOT NULL DEFAULT '',
  key_hint TEXT NOT NULL DEFAULT '',
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES app_user(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
);
