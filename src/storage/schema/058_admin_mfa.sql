BEGIN;

ALTER TABLE app_session ADD COLUMN mfa_verified_at TIMESTAMPTZ;
ALTER TABLE app_session ADD COLUMN mfa_step_up_at TIMESTAMPTZ;

CREATE TABLE app_auth_mfa (
  user_id UUID PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  encrypted_secret TEXT NOT NULL,
  last_step BIGINT NOT NULL CHECK (last_step >= 0),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 10),
  failure_until TIMESTAMPTZ,
  recovery_hashes TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(recovery_hashes) <= 8)
);

CREATE TABLE app_auth_mfa_login (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  credential_version INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5)
);

CREATE INDEX app_auth_mfa_login_expiry_idx ON app_auth_mfa_login (expires_at);
CREATE INDEX app_auth_mfa_login_user_idx ON app_auth_mfa_login (user_id);

COMMIT;
