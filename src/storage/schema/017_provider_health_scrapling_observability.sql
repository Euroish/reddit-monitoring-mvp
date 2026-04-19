-- Add Scrapling profile/session-key observability to provider_health_window.

BEGIN;

ALTER TABLE provider_health_window
  ADD COLUMN IF NOT EXISTS scrapling_http_profile_count INTEGER NOT NULL DEFAULT 0 CHECK (scrapling_http_profile_count >= 0),
  ADD COLUMN IF NOT EXISTS scrapling_dynamic_profile_count INTEGER NOT NULL DEFAULT 0 CHECK (scrapling_dynamic_profile_count >= 0),
  ADD COLUMN IF NOT EXISTS scrapling_stealth_profile_count INTEGER NOT NULL DEFAULT 0 CHECK (scrapling_stealth_profile_count >= 0),
  ADD COLUMN IF NOT EXISTS scrapling_session_key_count INTEGER NOT NULL DEFAULT 0 CHECK (scrapling_session_key_count >= 0),
  ADD COLUMN IF NOT EXISTS scrapling_session_key_reuse_count INTEGER NOT NULL DEFAULT 0 CHECK (scrapling_session_key_reuse_count >= 0),
  ADD COLUMN IF NOT EXISTS last_scrapling_profile TEXT,
  ADD COLUMN IF NOT EXISTS last_scrapling_fetcher TEXT,
  ADD COLUMN IF NOT EXISTS last_scrapling_session_key TEXT;

COMMIT;
