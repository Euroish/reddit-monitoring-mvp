import type { Pool } from "pg";
import type { ContentProvider } from "../../connectors/shared/content-provider.interface";

export async function scheduleDueSourcesOnce(pool: Pool, providers: ContentProvider[]) {
  const limits = Object.fromEntries(providers.filter(({ capability }) => capability.enabled).map(({ capability }) => [
    capability.provider, capability.requestResourceUpperBound ??
      (capability.provider === "feed" || capability.provider === "newsnow" ? 30 : 100),
  ]));
  if (!Object.keys(limits).length) return;
  await pool.query(`
    WITH due AS MATERIALIZED (
      SELECT cs.id,cs.primary_provider,cs.schedule,page.size AS page_size,
        GREATEST(COALESCE(cs.incremental_to - make_interval(secs =>
          COALESCE((cs.schedule->>'overlapSeconds')::int,300)),
          now() - make_interval(hours => COALESCE((cs.schedule->>'initialLookbackHours')::int,24))),
          now() - make_interval(hours => CASE WHEN cs.incremental_to IS NULL
            THEN COALESCE((cs.schedule->>'initialLookbackHours')::int,24)
            ELSE COALESCE((cs.schedule->>'maxCatchupHours')::int,6) END)) AS from_at,
        now() AS to_at
      FROM collection_source cs
      CROSS JOIN LATERAL (SELECT ($1::jsonb->>cs.primary_provider)::int AS cap) provider
      CROSS JOIN LATERAL (SELECT LEAST(COALESCE((cs.schedule->>'pageSize')::int,25), provider.cap,
        CASE WHEN cs.primary_provider='feed' AND cs.last_checked_at IS NULL THEN 8
          WHEN cs.target->>'type'='post' AND cs.primary_provider IN ('kaix','red_crawler') THEN 50 END) AS size) page
      WHERE cs.state='active' AND cs.delivery_mode='pull' AND NOT cs.automatic_collection_blocked
        AND provider.cap IS NOT NULL AND cs.schedule @> '{"enabled":true}'
        AND cs.next_due_at<=now()
        AND provider_ready_at(cs.primary_provider,
          CASE WHEN cs.primary_provider IN ('twitterapis','scrapebadger') THEN provider.cap ELSE page.size+1 END)<=now()
        AND NOT EXISTS (SELECT 1 FROM source_collection_job j WHERE j.collection_source_id=cs.id
          AND j.status IN ('queued','retrying','running') AND j.operation<>'hydrate')
      ORDER BY cs.next_due_at,cs.id LIMIT 16 FOR UPDATE OF cs SKIP LOCKED
    ), enqueued AS (
      INSERT INTO source_collection_job(id,collection_source_id,status,purpose,operation,provider,from_at,to_at,
        page_size,max_pages,next_run_at,created_at)
      SELECT gen_random_uuid(),id,'queued','scheduled','radar',primary_provider,
        LEAST(from_at,to_at - interval '1 second'),to_at,page_size,COALESCE((schedule->>'maxPages')::int,5),now(),now()
      FROM due RETURNING collection_source_id
    )
    UPDATE collection_source cs SET next_due_at=now() + make_interval(secs =>
      COALESCE((schedule->>'intervalSeconds')::int,(schedule->>'cadenceSeconds')::int,3600))
    FROM enqueued WHERE cs.id=enqueued.collection_source_id`, [limits]);
}
