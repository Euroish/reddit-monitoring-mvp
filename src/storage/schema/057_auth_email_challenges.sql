BEGIN;

ALTER TABLE app_user ADD COLUMN email_verified_at TIMESTAMPTZ;
ALTER TABLE app_invite ADD COLUMN recipient_email TEXT;

CREATE TABLE app_auth_challenge (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'verify', 'reset')),
  email TEXT NOT NULL,
  user_id UUID REFERENCES app_user(id) ON DELETE CASCADE,
  credential_version INTEGER,
  invite_id UUID REFERENCES app_invite(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at),
  consumed_at TIMESTAMPTZ,
  CHECK ((purpose = 'register' AND user_id IS NULL AND credential_version IS NULL)
      OR (purpose <> 'register' AND user_id IS NOT NULL AND credential_version IS NOT NULL AND invite_id IS NULL))
);

CREATE INDEX app_auth_challenge_created_idx ON app_auth_challenge (created_at);
CREATE INDEX app_auth_challenge_email_created_idx ON app_auth_challenge (email, created_at DESC);
CREATE INDEX app_auth_challenge_user_idx ON app_auth_challenge (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX app_auth_challenge_invite_idx ON app_auth_challenge (invite_id) WHERE invite_id IS NOT NULL;

COMMIT;
