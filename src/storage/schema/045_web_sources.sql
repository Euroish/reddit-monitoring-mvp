BEGIN;
ALTER TABLE collection_source ADD COLUMN last_checked_at TIMESTAMPTZ;
INSERT INTO source_provider_budget(provider,enabled,daily_requests,monthly_requests,daily_resources,monthly_resources)
VALUES ('newsnow',FALSE,0,0,0,0),('feed',FALSE,0,0,0,0)
ON CONFLICT(provider) DO NOTHING;
COMMIT;
