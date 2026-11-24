import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type { ContentProvider } from "../../connectors/shared/content-provider.interface";
import { AppError, fail } from "../../shared/errors";
import { getUserRoleStatus } from "../access/index";
import { findCommunityHydrationCandidates } from "../content/index";
import { admitViewerCollection } from "./policy";
import { audit, lockSource } from "./sql";

export const budgetedSocialProviders = ["kaix", "red_crawler", "twitterapis", "scrapebadger"];
export const DAILY_SOCIAL_ITEM_CEILING = 20_000;
const commentLimit = 15;
const reservedItems = commentLimit + 1;

export interface GlobalSocialBudget {
  dailySocialItemCeiling: number;
  autoHydrationEnabled: boolean;
  revision: number;
  updatedAt: string | null;
}

export async function getGlobalSocialBudget(db: Pool | PoolClient): Promise<GlobalSocialBudget> {
  const { rows: [row] } = await db.query<{
    daily_social_item_ceiling: number;
    auto_hydration_enabled: boolean;
    revision: number;
    updated_at: Date;
  }>(
    "SELECT daily_social_item_ceiling, auto_hydration_enabled, revision, updated_at FROM source_global_budget WHERE id='default'",
  );
  if (!row) {
    return {
      dailySocialItemCeiling: DAILY_SOCIAL_ITEM_CEILING,
      autoHydrationEnabled: true,
      revision: 1,
      updatedAt: null,
    };
  }
  return {
    dailySocialItemCeiling: Number(row.daily_social_item_ceiling),
    autoHydrationEnabled: Boolean(row.auto_hydration_enabled),
    revision: Number(row.revision),
    updatedAt: row.updated_at?.toISOString() ?? null,
  };
}

export async function updateGlobalSocialBudget(
  client: PoolClient,
  actor: Actor,
  input: { dailySocialItemCeiling: number; autoHydrationEnabled: boolean; revision: number },
): Promise<GlobalSocialBudget> {
  const { rows: [updated] } = await client.query<{
    daily_social_item_ceiling: number;
    auto_hydration_enabled: boolean;
    revision: number;
    updated_at: Date;
  }>(
    `UPDATE source_global_budget
     SET daily_social_item_ceiling=$1, auto_hydration_enabled=$2,
         revision=revision+1, updated_by=$3, updated_at=NOW()
     WHERE id='default' AND revision=$4
     RETURNING daily_social_item_ceiling, auto_hydration_enabled, revision, updated_at`,
    [input.dailySocialItemCeiling, input.autoHydrationEnabled, actor.userId, input.revision],
  );
  if (!updated) fail(409, "Global budget changed; reload before saving");
  await client.query(
    `UPDATE source_collection_job
     SET next_run_at=NOW()
     WHERE status='queued' AND error='Waiting for system social budget'`,
  );
  await audit(client, actor, "provider.global_budget", "default");
  return {
    dailySocialItemCeiling: Number(updated.daily_social_item_ceiling),
    autoHydrationEnabled: Boolean(updated.auto_hydration_enabled),
    revision: Number(updated.revision),
    updatedAt: updated.updated_at.toISOString(),
  };
}

export async function lockSocialDispatchBudget(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock(728419, 3)");
}

export async function socialResourcesReservedToday(db: Pool | PoolClient): Promise<number> {
  const { rows: [row] } = await db.query<{ reserved: number }>(
    `SELECT COALESCE(SUM(resources_reserved), 0)::float8 AS reserved FROM source_provider_usage
     WHERE provider=ANY($1::text[]) AND day=(now() AT TIME ZONE 'UTC')::date`,
    [budgetedSocialProviders],
  );
  return row.reserved;
}

export async function deferSocialCollectionOutsideBudget(client: PoolClient, jobId: string, token: string, resources: number) {
  const { dailySocialItemCeiling } = await getGlobalSocialBudget(client);
  if (await socialResourcesReservedToday(client) + resources <= dailySocialItemCeiling) return false;
  await client.query(
    `UPDATE source_collection_job SET status='queued',next_run_at=date_trunc('day',now(),'UTC')+interval '24 hours',
       lease_token=NULL,lease_until=NULL,attempts=attempts-1,error='Waiting for system social budget'
     WHERE id=$1 AND lease_token=$2 AND status='running'`,
    [jobId, token],
  );
  return true;
}

export async function enqueueAutomaticCommunityHydration(
  client: PoolClient,
  providers: ContentProvider[],
  input: { sourceId: string; monitorId: string; dailyItemBudget: number; ownerUserId: string },
): Promise<boolean> {
  const globalBudget = await getGlobalSocialBudget(client);
  if (!globalBudget.autoHydrationEnabled) return false;
  const source = await lockSource(client, { allowedSourceIds: null } as Actor, input.sourceId, false);
  if (source.state !== "active" || source.platform !== "reddit" || source.target.type !== "community" ||
      source.delivery_mode !== "pull" || source.automatic_collection_blocked) return false;

  const providerNames = [source.primary_provider, source.fallback_provider].filter((name) =>
    ["kaix", "red_crawler"].includes(name) && providers.some(({ capability }) =>
      capability.enabled && capability.platform === "reddit" && capability.provider === name),
  );
  if (!providerNames.length) return false;

  const owner = await getUserRoleStatus(client, input.ownerUserId);
  if (owner?.status !== "active") return false;
  const actor = {
    userId: input.ownerUserId, role: owner.role, clientKind: "browser", allowedSourceIds: null,
  } as Actor;
  const candidates = await findCommunityHydrationCandidates(client, source.id, source.target.community);
  if (!candidates.length) return false;

  await lockSocialDispatchBudget(client);
  const [{ rows: [budget] }, { rows: [monitorUsage] }] = await Promise.all([
    client.query<{ monitor_items: number; queued_items: number }>(
      `SELECT
         COALESCE(SUM(page_size + 1) FILTER (
           WHERE request_json->>'autoMonitorId'=$1
             AND created_at >= date_trunc('day', now(), 'UTC')
             AND (status<>'cancelled' OR request_count>0)
         ),0)::int AS monitor_items,
         COALESCE(SUM(page_size + 1) FILTER (
           WHERE status IN ('queued','retrying','running') AND request_count=0
         ),0)::int AS queued_items
       FROM source_collection_job WHERE operation='hydrate' AND request_json ? 'autoMonitorId'`,
      [input.monitorId],
    ),
    client.query<{ used: number }>(
      `SELECT COALESCE(resources_reserved, 0)::int AS used FROM intel_monitor_usage
       WHERE monitor_id=$1 AND day=(NOW() AT TIME ZONE 'UTC')::date`,
      [input.monitorId],
    ),
  ]);
  const usedMonitorBudget = Math.max(monitorUsage?.used ?? 0, budget.monitor_items);
  if (usedMonitorBudget + reservedItems > input.dailyItemBudget ||
      await socialResourcesReservedToday(client) + budget.queued_items + reservedItems > globalBudget.dailySocialItemCeiling) return false;

  const { rows: choices } = await client.query<{ post_id: string; name: string; ready_at: Date }>(
    `WITH candidate AS (
       SELECT post_id FROM unnest($2::text[]) WITH ORDINALITY AS items(post_id, priority)
       WHERE NOT EXISTS (
         SELECT 1 FROM source_collection_job j
         WHERE j.collection_source_id=$1 AND j.operation='hydrate'
           AND ((j.request_json ? 'autoMonitorId' AND j.status IN ('queued','running','retrying'))
             OR (j.request_json->>'postId'=items.post_id
               AND (j.status IN ('queued','running','retrying','succeeded')
                 OR j.provider_state->>'phase'='unknown'
                 OR (j.request_json ? 'autoMonitorId' AND j.request_count>0))))
       )
       ORDER BY priority LIMIT 1
     ), provider AS (
       SELECT name, ready_at, priority FROM unnest($3::text[]) WITH ORDINALITY AS p(name, priority)
       CROSS JOIN LATERAL (SELECT provider_ready_at(name, $4 + 1) AS ready_at) ready
       WHERE ready_at < date_trunc('day', now(), 'UTC') + interval '24 hours'
     )
     SELECT post_id, name, ready_at FROM candidate CROSS JOIN provider ORDER BY ready_at, priority`,
    [source.id, candidates, providerNames, commentLimit],
  );
  for (const choice of choices) {
    try {
      await admitViewerCollection(client, actor, {
        provider: choice.name, sourceId: source.id, limit: commentLimit, resources: reservedItems,
        includeComments: true, maxCommentsPerPost: commentLimit,
      });
    } catch (error) {
      if (error instanceof AppError && [403, 422, 429].includes(error.statusCode)) continue;
      throw error;
    }
    await client.query(
      `INSERT INTO source_collection_job(id,collection_source_id,status,purpose,operation,provider,from_at,to_at,
         page_size,max_pages,next_run_at,created_at,request_json,requested_by_user_id,requested_by_client_kind)
       VALUES($1,$2,'queued','manual','hydrate',$3,now()-interval '1 second',now(),$4,1,$5,now(),
         jsonb_build_object('postId',$6::text,'includeComments',true,'maxCommentsPerPost',$4::int,'autoMonitorId',$7::text),
         $8,'browser')`,
      [randomUUID(), source.id, choice.name, commentLimit, choice.ready_at, choice.post_id, input.monitorId, input.ownerUserId],
    );
    return true;
  }
  return false;
}

export async function cancelUnstartedMonitorHydrations(client: PoolClient, monitorId: string) {
  await client.query(
    `UPDATE source_collection_job SET status='cancelled',finished_at=now(),lease_token=NULL,lease_until=NULL
     WHERE operation='hydrate' AND request_json->>'autoMonitorId'=$1
       AND status IN ('queued','running','retrying') AND request_count=0`,
    [monitorId],
  );
}

export async function cancelHydrationOutsideBudget(client: PoolClient, jobId: string, token: string, resources: number) {
  const [reserved, globalBudget] = await Promise.all([
    socialResourcesReservedToday(client),
    getGlobalSocialBudget(client),
  ]);
  const { rowCount } = await client.query(
    `UPDATE source_collection_job SET status='cancelled',finished_at=now(),lease_token=NULL,lease_until=NULL,
       error='Automatic hydration reservation is unavailable'
     WHERE id=$1 AND lease_token=$2 AND request_json ? 'autoMonitorId'
       AND (request_count > 0 OR NOT $6::boolean OR created_at < date_trunc('day', now(), 'UTC')
         OR $3::float8 > $4::float8
         OR provider_ready_at(provider, $5) >= date_trunc('day', now(), 'UTC') + interval '24 hours')`,
    [jobId, token, reserved + resources, globalBudget.dailySocialItemCeiling, resources, globalBudget.autoHydrationEnabled],
  );
  return Boolean(rowCount);
}
