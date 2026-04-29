CREATE TABLE IF NOT EXISTS runtime_setting (
  setting_key TEXT PRIMARY KEY,
  value_json JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
