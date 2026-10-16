BEGIN;

-- The platform owns content identity; provider credentials and budgets remain private runtime configuration.
INSERT INTO source (id, code, name)
VALUES ('22222222-2222-2222-2222-222222222222', 'x', 'X')
ON CONFLICT (code) DO NOTHING;

COMMIT;
