import { randomUUID } from "node:crypto";
import type { Static } from "@sinclair/typebox";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import type {
  CollectionSource,
  PublicSourceDirectory,
  SourceInput,
  SourceListQuery,
  SourceTarget,
} from "../../../packages/contracts/src/collection";
import { fail } from "../../shared/errors";
import { writeAuditLog } from "../access/index";
import { countDiscoveriesBySourceSince, hasSourceDiscoveries } from "../content/index";

export const sourceSelect =
  "SELECT cs.*,s.code AS platform FROM collection_source cs JOIN source s ON s.id=cs.platform_id";

export function sourceFromRow(row: import("pg").QueryResultRow): CollectionSource {
  return {
    id: row.id,
    platform: row.platform,
    primaryProvider: row.primary_provider,
    fallbackProvider: row.fallback_provider,
    deliveryMode: row.delivery_mode,
    label: row.label,
    target: row.target,
    contentKind: row.content_kind,
    state: row.state,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    revision: row.revision,
    schedule: row.schedule,
    tier: row.tier,
    ownerEntityId: row.owner_entity_id,
    sourceGroup: row.source_group ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    locale: row.locale ?? null,
    fetchPolicy: row.fetch_policy ?? {},
    feedLane: row.feed_lane ?? "discussion",
    qualityGrade: row.quality_grade ?? null,
    health: row.health ?? {},
    hasHttpCache: Boolean(row.http_etag || row.http_last_modified),
    nextDueAt: row.next_due_at?.toISOString() ?? null,
    lastCheckedAt: row.last_checked_at?.toISOString() ?? null,
    lastSuccessAt: row.last_success_at?.toISOString() ?? null,
    automaticCollectionBlocked: row.automatic_collection_blocked,
    coverage: row.coverage,
    usageDomain: row.usage_domain ?? (row.platform === "web" ? "feed" : "research"),
  };
}

export async function listSources(
  pool: Pool,
  actor: Actor,
  query: Static<typeof SourceListQuery>,
): Promise<CollectionSource[]> {
  const values: unknown[] = [actor.allowedSourceIds];
  const where = ["($1::uuid[] IS NULL OR cs.id=ANY($1))"];
  if (query.sourceGroup) where.push(`cs.source_group=$${values.push(query.sourceGroup)}`);
  if (query.tier) where.push(`cs.tier=$${values.push(query.tier)}`);
  if (query.state) where.push(`cs.state=$${values.push(query.state)}`);
  if (query.feedLane) where.push(`cs.feed_lane=$${values.push(query.feedLane)}`);
  if (query.truncatedOnly) where.push("COALESCE((cs.health->>'lastTruncated')::boolean,false)");
  const { rows } = await pool.query(
    `${sourceSelect} WHERE ${where.join(" AND ")} ORDER BY cs.created_at,cs.id`,
    values,
  );
  return rows.map(sourceFromRow);
}

export async function listSourcesByIds(db: Pool | PoolClient, ids: readonly string[]): Promise<CollectionSource[]> {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const { rows } = await db.query(`${sourceSelect} WHERE cs.id=ANY($1::uuid[]) ORDER BY cs.created_at,cs.id`, [unique]);
  return rows.map(sourceFromRow);
}

export async function insertSource(
  pool: Pool | PoolClient,
  input: Static<typeof SourceInput>,
  target: SourceTarget,
  mode: "admin" | "monitor" = "admin",
): Promise<CollectionSource> {
  const archived = mode === "admin" ? (
    await pool.query<{ id: string }>(
      `SELECT cs.id FROM collection_source cs JOIN source s ON s.id=cs.platform_id
       WHERE s.code=$1 AND cs.primary_provider=$2 AND cs.content_kind=$3 AND cs.target=$4::jsonb AND cs.state='archived'`,
      [input.platform, input.primaryProvider, input.contentKind, target],
    )
  ).rows[0] : undefined;
  if (archived) {
    const schedule = input.schedule ?? { enabled: false };
    await pool.query(
      `UPDATE collection_source
       SET state='active',delivery_mode=$2,label=$3,fallback_provider=$4,schedule=$5::jsonb,
           next_due_at=CASE WHEN $5::jsonb @> '{"enabled":true}' THEN now() ELSE NULL END,
           tier=$6,owner_entity_id=$7,source_group=$8,tags=$9,locale=$10,fetch_policy=$11::jsonb,
           feed_lane=$12,quality_grade=$13,revision=revision+1,updated_at=NOW()
       WHERE id=$1`,
      [
        archived.id, input.deliveryMode, input.label, input.fallbackProvider ?? null, schedule,
        input.tier ?? "T2", input.ownerEntityId ?? null, input.sourceGroup ?? null, input.tags ?? [],
        input.locale ?? null, input.fetchPolicy ?? {}, input.feedLane ?? "discussion", input.qualityGrade ?? null,
      ],
    );
    return sourceFromRow((await pool.query(`${sourceSelect} WHERE cs.id=$1`, [archived.id])).rows[0]);
  }
  const row = (
    await pool.query(
      `INSERT INTO collection_source(
        id,platform_id,primary_provider,label,target,content_kind,delivery_mode,
        fallback_provider,created_at,updated_at,schedule,next_due_at,tier,
        owner_entity_id,source_group,tags,locale,fetch_policy,feed_lane,quality_grade,usage_domain
      )
      SELECT $1,id,$2,$3,$4,$5,$6,$8,NOW(),NOW(),$9::jsonb,
        CASE WHEN $9::jsonb @> '{"enabled":true}' THEN now() END,
        $10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18
      FROM source WHERE code=$7 RETURNING id`,
      [
        randomUUID(), input.primaryProvider, input.label, target, input.contentKind, input.deliveryMode,
        input.platform, input.fallbackProvider ?? null, input.schedule ?? { enabled: false },
        input.tier ?? "T2", input.ownerEntityId ?? null, input.sourceGroup ?? null, input.tags ?? [],
        input.locale ?? null, input.fetchPolicy ?? {}, input.feedLane ?? "discussion", input.qualityGrade ?? null,
        input.platform === "web" ? "feed" : "research",
      ],
    )
  ).rows[0];
  if (!row) fail(422, "Platform not registered");
  return sourceFromRow((await pool.query(`${sourceSelect} WHERE cs.id=$1`, [row.id])).rows[0]);
}

export function assertSource(actor: Actor, id: string) {
  if (actor.allowedSourceIds !== null && !actor.allowedSourceIds.includes(id))
    fail(404, "Source not found");
}

export async function lockSource(client: PoolClient, actor: Actor, id: string, requireActive = true) {
  assertSource(actor, id);
  const row = (await client.query(`${sourceSelect} WHERE cs.id=$1 FOR UPDATE OF cs`, [id])).rows[0];
  if (!row) fail(404, "Source not found");
  if (requireActive && row.state !== "active") fail(409, "Source must be active");
  return row;
}

export async function removeOrArchiveSource(
  client: PoolClient,
  actor: Actor,
  id: string,
): Promise<{ deleted: true; mode: "deleted" | "archived" }> {
  const source = await lockSource(client, actor, id, false);
  const running = await client.query(
    "SELECT 1 FROM source_collection_job WHERE collection_source_id=$1 AND status='running' LIMIT 1",
    [id],
  );
  if (running.rowCount) fail(409, "Cannot delete source with a running collection job");
  await client.query(
    `UPDATE source_collection_job
     SET status='cancelled',finished_at=NOW(),lease_token=NULL,lease_until=NULL
     WHERE collection_source_id=$1 AND status IN ('queued','retrying')`,
    [id],
  );
  const [hasDisc, { rows: [history] }] = await Promise.all([
    hasSourceDiscoveries(client, id),
    client.query<{ exists: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM source_collection_job WHERE collection_source_id=$1)
           OR EXISTS (SELECT 1 FROM collection_batch WHERE collection_source_id=$1) AS exists`,
      [id],
    ),
  ]);
  if (!hasDisc && !history.exists) {
    await client.query("DELETE FROM collection_source WHERE id=$1", [id]);
    await audit(client, actor, "source.delete", source.id);
    return { deleted: true, mode: "deleted" };
  }
  await client.query(
    `UPDATE collection_source
     SET state='archived',feed_lane='news',
         schedule=jsonb_set(COALESCE(schedule,'{}'::jsonb),'{enabled}','false'::jsonb,true),
         next_due_at=NULL,revision=revision+1,updated_at=NOW()
     WHERE id=$1`,
    [id],
  );
  await audit(client, actor, "source.archive", source.id);
  return { deleted: true, mode: "archived" };
}

export async function listPublicSources(
  pool: Pool,
  actor: Actor,
): Promise<Static<typeof PublicSourceDirectory>> {
  const [countsMap, { rows }] = await Promise.all([
    countDiscoveriesBySourceSince(pool, 48),
    pool.query(
      `SELECT cs.id, cs.label, s.code AS platform, cs.source_group, cs.tier, cs.locale, cs.state, cs.feed_lane, cs.last_success_at, cs.created_at
       FROM collection_source cs
       JOIN source s ON s.id = cs.platform_id
       WHERE cs.state = 'active' AND ($1::uuid[] IS NULL OR cs.id = ANY($1))`,
      [actor.allowedSourceIds],
    ),
  ]);
  const groupCounts: Record<string, number> = {};
  const sources = rows
    .map((row) => {
      const sourceGroup: string | null = row.source_group ?? null;
      const count48h = countsMap.get(row.id) ?? 0;
      if (sourceGroup) groupCounts[sourceGroup] = (groupCounts[sourceGroup] ?? 0) + count48h;
      return {
        id: row.id,
        label: row.label,
        platform: row.platform,
        sourceGroup,
        tier: row.tier,
        locale: row.locale ?? null,
        state: row.state,
        feedLane: row.feed_lane ?? "discussion",
        lastSuccessAt: row.last_success_at?.toISOString() ?? null,
        count48h,
        _createdMs: row.created_at instanceof Date ? row.created_at.getTime() : 0,
      };
    })
    .sort((a, b) => b.count48h - a.count48h || a._createdMs - b._createdMs || a.id.localeCompare(b.id))
    .map(({ _createdMs, ...item }) => item);
  return { sources, groupCounts };
}

export async function audit(
  pool: Pool | PoolClient,
  actor: Actor,
  action: string,
  resourceId?: string,
) {
  await writeAuditLog(pool, {
    actorUserId: actor.userId,
    actorType: actor.clientKind === "machine" ? "machine" : "session",
    action,
    resourceId: resourceId ?? null,
  });
}

export async function allSourcesExist(db: Pool | PoolClient, ids: string[]): Promise<boolean> {
  const unique = [...new Set(ids)];
  if (!unique.length) return true;
  const row = (
    await db.query<{ cnt: string }>("SELECT COUNT(*)::text AS cnt FROM collection_source WHERE id=ANY($1::uuid[])", [unique])
  ).rows[0];
  return Number(row?.cnt ?? 0) === unique.length;
}
