import { randomUUID } from "node:crypto";
import type { Static } from "@sinclair/typebox";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type { CollectionSource, SourceInput } from "../../../packages/contracts/src/collection";
import type { ContentProvider } from "../../connectors/shared/content-provider.interface";
import { fail } from "../../shared/errors";
import { canonical } from "../content/index";
import { validateSource } from "./config";
import { admitViewerCollection, viewerCollectionDemand } from "./policy";
import { insertSource, lockSource, sourceFromRow, sourceSelect } from "./sql";

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
       WHERE s.code = $1 AND cs.primary_provider = $2 AND cs.content_kind = $3 AND cs.target = $4::jsonb
       FOR UPDATE OF cs`,
      [input.platform, input.primaryProvider, input.contentKind, target],
    )
  ).rows[0];
  if (existing) {
    if (existing.state !== "active") {
      await client.query(
        `UPDATE collection_source
         SET state='active',schedule=COALESCE($2::jsonb,schedule),
             next_due_at=CASE WHEN COALESCE($2::jsonb,schedule) @> '{"enabled":true}' THEN COALESCE(next_due_at,now()) END,
             revision=revision+1,updated_at=NOW()
         WHERE id=$1`,
        [existing.id, input.schedule ?? null],
      );
      return sourceFromRow((await client.query(`${sourceSelect} WHERE cs.id=$1`, [existing.id])).rows[0]);
    }
    return sourceFromRow(existing);
  }
  return insertSource(client, input, target);
}

export async function enqueueCollectionForSource(
  client: PoolClient,
  actor: Actor,
  providers: ContentProvider[],
  input: {
    sourceId: string;
    from: string;
    to: string;
    limit: number;
    includeComments?: boolean;
    maxCommentsPerPost?: number;
    requestKey: string;
  },
): Promise<{ jobId: string; created: boolean }> {
  const source = await lockSource(client, actor, input.sourceId);
  if (source.delivery_mode !== "pull") fail(409, "Push sources cannot be scheduled");
  if (source.automatic_collection_blocked) fail(409, "Collection is blocked pending unresolved review");
  const body = {
    from: input.from,
    to: input.to,
    limit: input.limit,
    includeComments: Boolean(input.includeComments),
    maxCommentsPerPost: input.maxCommentsPerPost,
  };
  const previous = (
    await client.query(
      "SELECT id, request_json FROM source_collection_job WHERE collection_source_id=$1 AND request_key=$2 AND purpose='collect' AND operation='radar'",
      [source.id, input.requestKey],
    )
  ).rows[0];
  if (previous) {
    if (canonical(previous.request_json) !== canonical(body)) {
      fail(409, "Idempotency key already used with different collection parameters");
    }
    return { jobId: previous.id, created: false };
  }
  const providerName: string = source.primary_provider;
  const provider = providers.find(
    (item) => item.capability.provider === providerName && item.capability.platform === source.platform,
  );
  if (!provider?.capability.enabled) {
    fail(422, `Provider ${providerName} networking is disabled or credentials are missing`);
  }
  const pageSize = providerName === "twitterapis" ? Math.min(input.limit, 20) : input.limit;
  if (actor.role === "viewer") {
    await admitViewerCollection(client, actor, {
      sourceId: source.id,
      ...viewerCollectionDemand(providerName, source.target.type, pageSize, body),
    });
  }
  const id = randomUUID();
  await client.query(
    `INSERT INTO source_collection_job(
       id,collection_source_id,status,purpose,operation,provider,from_at,to_at,
       page_size,max_pages,next_run_at,created_at,request_key,request_json,requested_by_user_id,requested_by_client_kind
     )
     VALUES($1,$2,'queued','collect','radar',$3,$4,$5,$6,1,NOW(),NOW(),$7,$8,$9,$10)`,
    [id, source.id, providerName, input.from, input.to, pageSize, input.requestKey, body, actor.userId, actor.clientKind],
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
