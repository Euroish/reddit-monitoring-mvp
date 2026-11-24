import { randomUUID } from "node:crypto";
import type { Static } from "@sinclair/typebox";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type { Collect, CollectionSource, SourceInput } from "../../../packages/contracts/src/collection";
import type { ContentProvider } from "../../connectors/shared/content-provider.interface";
import { fail } from "../../shared/errors";
import { canonical } from "../content/index";
import { collectionRequestRestriction, isCollectionBudgetDisabled, validateSource } from "./config";
import { admitViewerCollection, viewerCollectionDemand } from "./policy";
import { audit, insertSource, lockSource, sourceFromRow } from "./sql";

export async function ensureManagedSource(
  client: PoolClient,
  providers: ContentProvider[],
  input: Static<typeof SourceInput>,
): Promise<CollectionSource> {
  const { target } = validateSource(providers, input);
  const existing = (
    await client.query(
      `SELECT cs.*, s.code AS platform
       FROM collection_source cs
       JOIN source s ON s.id = cs.platform_id
       WHERE s.code = $1 AND cs.primary_provider = $2 AND cs.content_kind = $3 AND cs.target = $4::jsonb`,
      [input.platform, input.primaryProvider, input.contentKind, target],
    )
  ).rows[0];
  if (existing) {
    if (existing.state !== "active" || existing.delivery_mode !== "pull") {
      fail(409, "Matching source is unavailable; review its state and delivery mode in source management");
    }
    return sourceFromRow(existing);
  }
  return insertSource(client, input, target, "monitor");
}

export async function syncManagedMonitorSchedules(
  client: PoolClient,
  schedules: ReadonlyArray<{ sourceId: string; cadenceSeconds: number | null }>,
) {
  if (!schedules.length) return;
  const sourceIds = schedules.map(item => item.sourceId);
  await client.query(
    "SELECT id FROM collection_source WHERE monitor_managed AND id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
    [sourceIds],
  );
  await client.query(
    `WITH desired AS (
       SELECT * FROM unnest($1::uuid[], $2::int[]) AS input(id,cadence)
     ), changed AS (
       UPDATE collection_source cs
       SET schedule=(cs.schedule - 'intervalSeconds') || CASE WHEN d.cadence IS NULL
             THEN '{"enabled":false}'::jsonb ELSE jsonb_build_object('enabled',true,'cadenceSeconds',d.cadence) END,
           next_due_at=CASE WHEN d.cadence IS NOT NULL THEN now() END,
           updated_at=now(),revision=cs.revision+1
       FROM desired d WHERE cs.id=d.id AND cs.monitor_managed AND (
         (d.cadence IS NULL AND (cs.schedule @> '{"enabled":true}' OR cs.next_due_at IS NOT NULL)) OR
         (d.cadence IS NOT NULL AND cs.state='active' AND
           (NOT (cs.schedule @> '{"enabled":true}') OR cs.schedule->>'cadenceSeconds' IS DISTINCT FROM d.cadence::text))
       ) RETURNING cs.id, d.cadence
     ) UPDATE source_collection_job j SET status='cancelled',finished_at=now(),lease_token=NULL,lease_until=NULL
       FROM changed c WHERE j.collection_source_id=c.id AND c.cadence IS NULL AND j.purpose='scheduled'
         AND j.status IN ('queued','retrying') AND j.provider_state='{}'`,
    [sourceIds, schedules.map(item => item.cadenceSeconds)],
  );
}

function collectionProvider(source: QueryResultRow, body: Static<typeof Collect>, providers: ContentProvider[]) {
  if (source.delivery_mode !== "pull") fail(409, "Push sources cannot be scheduled");
  const from = Date.parse(body.from);
  const to = Date.parse(body.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) fail(422, "Invalid collection window");
  const providerName = body.useFallback ? source.fallback_provider : source.primary_provider;
  if (!providerName) fail(422, "No fallback provider configured for this source");
  const provider = providers.find(
    item => item.capability.provider === providerName && item.capability.platform === source.platform,
  );
  const restriction = collectionRequestRestriction(providerName, source.platform, source.target.type, body);
  if (restriction) fail(422, restriction);
  if (!provider?.capability.enabled) fail(422, "Provider networking is disabled or credentials are missing");
  if (source.automatic_collection_blocked) fail(409, "Collection is blocked pending review of an unresolved operation");
  return providerName as string;
}

export async function enqueueCollectionForSource(
  client: PoolClient,
  actor: Actor,
  providers: ContentProvider[],
  input: Static<typeof Collect> & {
    sourceId: string;
    requestKey: string;
    requestHash?: string;
    rejectCreate?: { statusCode: number; message: string };
  },
): Promise<{ jobId: string; created: boolean }> {
  const { sourceId, requestKey, requestHash, rejectCreate, ...body } = input;
  const source = await lockSource(client, actor, sourceId);
  const previous = (
    await client.query(
      "SELECT id,request_json,payload_hash,requested_by_user_id,requested_by_client_kind FROM source_collection_job WHERE collection_source_id=$1 AND request_key=$2 AND purpose='collect' AND operation='radar'",
      [source.id, requestKey],
    )
  ).rows[0];
  if (previous) {
    if (previous.requested_by_client_kind !== actor.clientKind ||
        previous.requested_by_user_id !== (actor.userId ?? null) ||
        (requestHash ? previous.payload_hash !== requestHash : canonical(previous.request_json) !== canonical(body))) {
      fail(409, "Idempotency key already used with different request");
    }
    return { jobId: previous.id, created: false };
  }
  if (rejectCreate) fail(rejectCreate.statusCode, rejectCreate.message);
  const providerName = collectionProvider(source, body, providers);
  if (body.projectId && await isCollectionBudgetDisabled(client, providerName))
    fail(409, "System channel budget is disabled or zero");
  const pageSize = providerName === "twitterapis" ? Math.min(body.limit, 20) : body.limit;
  await admitViewerCollection(client, actor, {
    sourceId: source.id, from: body.from, to: body.to, useFallback: body.useFallback,
    ...viewerCollectionDemand(providerName, source.target.type, pageSize, body),
  });
  const id = randomUUID();
  await client.query(
    `INSERT INTO source_collection_job(
       id,collection_source_id,status,purpose,operation,provider,from_at,to_at,
       page_size,max_pages,next_run_at,created_at,request_key,request_json,requested_by_user_id,requested_by_client_kind,payload_hash
     )
     VALUES($1,$2,'queued','collect','radar',$3,$4,$5,$6,1,NOW(),NOW(),$7,$8,$9,$10,$11)`,
    [id, source.id, providerName, body.from, body.to, pageSize, requestKey, body, actor.userId, actor.clientKind, requestHash ?? null],
  );
  return { jobId: id, created: true };
}

export interface ProviderDailyUsageSummary {
  provider: string;
  enabled: boolean;
  dailyRequests: number;
  dailyResources: number;
  requestsToday: number;
  resourcesToday: number;
}

export async function getProviderDailyUsage(
  db: Pool | PoolClient,
  providerNames: readonly string[],
): Promise<ProviderDailyUsageSummary[]> {
  if (!providerNames.length) return [];
  const { rows } = await db.query(
    `SELECT b.provider, b.enabled, b.daily_requests, b.daily_resources,
       COALESCE(u.requests, 0)::int AS requests_today,
       COALESCE(u.resources_reserved, 0)::int AS resources_today
     FROM source_provider_budget b
     LEFT JOIN source_provider_usage u ON u.provider = b.provider AND u.day = (now() AT TIME ZONE 'UTC')::date
     WHERE b.provider = ANY($1::text[])
     ORDER BY b.provider`,
    [providerNames],
  );
  return rows.map((r) => ({
    provider: r.provider,
    enabled: Boolean(r.enabled),
    dailyRequests: Number(r.daily_requests),
    dailyResources: Number(r.daily_resources),
    requestsToday: Number(r.requests_today),
    resourcesToday: Number(r.resources_today),
  }));
}

export interface LegacySourceCandidate {
  id: string;
  label: string;
  platform: string;
  primaryProvider: string;
  state: string;
  feedLane: string;
  usageDomain: string;
  monitorManaged: boolean;
  scheduleEnabled: boolean;
  schedule: Record<string, unknown>;
  nextDueAt: string | null;
  revision: number;
  automaticCollectionBlocked: boolean;
  recentJobStatus: string | null;
  recentJobAt: string | null;
  unresolvedCharges: number;
  resourcesToday: number;
}

export async function listLegacySources(db: Pool | PoolClient): Promise<LegacySourceCandidate[]> {
  const { rows } = await db.query(
    `SELECT cs.id, cs.label, s.code AS platform, cs.primary_provider, cs.state,
       cs.feed_lane, cs.usage_domain, cs.monitor_managed, cs.schedule, cs.next_due_at,
       cs.revision, cs.automatic_collection_blocked,
       rj.status AS recent_job_status, rj.created_at AS recent_job_at,
       COALESCE(uc.cnt, 0)::int AS unresolved_charges,
       COALESCE(td.resources_today, 0)::int AS resources_today
     FROM collection_source cs
     JOIN source s ON s.id = cs.platform_id
     LEFT JOIN LATERAL (
       SELECT status, created_at FROM source_collection_job
       WHERE collection_source_id = cs.id
       ORDER BY created_at DESC LIMIT 1
     ) rj ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*) AS cnt FROM source_collection_job
       WHERE collection_source_id = cs.id
         AND (provider_state->>'phase' IN ('unknown', 'starting') AND status <> 'succeeded')
     ) uc ON true
     LEFT JOIN LATERAL (
       SELECT SUM(page_size + 1) AS resources_today FROM source_collection_job
       WHERE collection_source_id = cs.id
         AND created_at >= date_trunc('day', now(), 'UTC')
         AND request_count > 0
     ) td ON true
     WHERE cs.usage_domain = 'research' AND NOT cs.monitor_managed
       AND (cs.feed_lane = 'monitor_only' OR cs.schedule @> '{"enabled":true}')
     ORDER BY cs.created_at, cs.id`,
  );
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    platform: r.platform,
    primaryProvider: r.primary_provider,
    state: r.state,
    feedLane: r.feed_lane,
    usageDomain: r.usage_domain,
    monitorManaged: Boolean(r.monitor_managed),
    scheduleEnabled: Boolean(r.schedule?.enabled),
    schedule: r.schedule ?? {},
    nextDueAt: r.next_due_at?.toISOString() ?? null,
    revision: Number(r.revision),
    automaticCollectionBlocked: Boolean(r.automatic_collection_blocked),
    recentJobStatus: r.recent_job_status ?? null,
    recentJobAt: r.recent_job_at?.toISOString() ?? null,
    unresolvedCharges: Number(r.unresolved_charges ?? 0),
    resourcesToday: Number(r.resources_today ?? 0),
  }));
}

export async function reconcileLegacySource(
  client: PoolClient,
  actor: Actor,
  sourceId: string,
  action: "pause_schedule" | "claim_monitor_managed",
  revision: number,
) {
  const source = await lockSource(client, actor, sourceId, false);
  if (source.revision !== revision) fail(409, "Source changed; reload before reconciling");
  if (action === "pause_schedule") {
    await client.query(
      `UPDATE collection_source
       SET schedule = jsonb_set(COALESCE(schedule, '{}'::jsonb), '{enabled}', 'false'::jsonb, true),
           next_due_at = NULL, revision = revision + 1, updated_at = NOW()
       WHERE id = $1`,
      [sourceId],
    );
    await client.query(
      `UPDATE source_collection_job
       SET status = 'cancelled', finished_at = NOW(), lease_token = NULL, lease_until = NULL
       WHERE collection_source_id = $1 AND purpose = 'scheduled'
         AND status IN ('queued', 'retrying') AND provider_state = '{}'`,
      [sourceId],
    );
    await audit(client, actor, "source.legacy.pause_schedule", sourceId);
  } else {
    await client.query(
      `UPDATE collection_source
       SET monitor_managed = TRUE, revision = revision + 1, updated_at = NOW()
       WHERE id = $1`,
      [sourceId],
    );
    await audit(client, actor, "source.legacy.claim_monitor_managed", sourceId);
  }
}
