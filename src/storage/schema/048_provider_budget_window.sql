BEGIN;
UPDATE collection_source SET next_due_at=now()
WHERE next_due_at IS NULL AND state='active' AND delivery_mode='pull' AND schedule @> '{"enabled":true}';

CREATE INDEX idx_waiting_collection_budget ON source_collection_job (provider)
WHERE status='queued' AND error='Waiting for provider budget';
CREATE FUNCTION provider_ready_at(provider_name text, resources integer) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT COALESCE((
    SELECT CASE WHEN NOT b.enabled OR LEAST(b.daily_requests,b.monthly_requests)<1
        OR LEAST(b.daily_resources,b.monthly_resources)<resources THEN 'infinity'::timestamptz
      ELSE GREATEST(
        b.last_request_at + b.minimum_interval_ms * interval '1 millisecond',
        CASE WHEN totals.month_requests>=b.monthly_requests OR totals.month_resources+resources>b.monthly_resources
          THEN (clock.month_start+interval '1 month') AT TIME ZONE 'UTC' END,
        CASE WHEN totals.day_requests>=b.daily_requests OR totals.day_resources+resources>b.daily_resources
          THEN (clock.today+interval '1 day') AT TIME ZONE 'UTC' END,
        now())
      END
    FROM source_provider_budget b
    CROSS JOIN (SELECT (now() AT TIME ZONE 'UTC')::date AS today,
      date_trunc('month',now() AT TIME ZONE 'UTC') AS month_start) clock
    CROSS JOIN LATERAL (
      SELECT COALESCE(SUM(requests),0) AS month_requests, COALESCE(SUM(resources_reserved),0) AS month_resources,
        COALESCE(SUM(requests) FILTER(WHERE day=clock.today),0) AS day_requests,
        COALESCE(SUM(resources_reserved) FILTER(WHERE day=clock.today),0) AS day_resources
      FROM source_provider_usage WHERE provider=b.provider AND day>=clock.month_start::date AND day<=clock.today
    ) totals
    WHERE b.provider=provider_name
  ), 'infinity'::timestamptz)
$$;
COMMIT;
