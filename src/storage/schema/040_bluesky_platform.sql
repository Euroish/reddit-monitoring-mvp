BEGIN;

-- The AT URI belongs to the platform; AppView is the provider, not the publisher identity.
INSERT INTO source (id, code, name)
VALUES ('33333333-3333-3333-3333-333333333333', 'bluesky', 'Bluesky')
ON CONFLICT (code) DO NOTHING;

COMMIT;
