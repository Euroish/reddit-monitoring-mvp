import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  Actor,
  CollectionSource,
} from "../../../packages/contracts/src/source-content";
import { fail } from "../../storage/db";

export const sourceSelect =
  "SELECT cs.*,s.code AS platform FROM collection_source cs JOIN source s ON s.id=cs.platform_id";
export function sourceFromRow(
  row: import("pg").QueryResultRow,
): CollectionSource {
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
    nextDueAt: row.next_due_at?.toISOString() ?? null,
    lastCheckedAt: row.last_checked_at?.toISOString() ?? null,
    lastSuccessAt: row.last_success_at?.toISOString() ?? null,
    automaticCollectionBlocked: row.automatic_collection_blocked,
    coverage: row.coverage,
  };
}
export function assertSource(actor: Actor, id: string) {
  if (actor.allowedSourceIds !== null && !actor.allowedSourceIds.includes(id))
    fail(404, "Source not found");
}
export async function lockSource(client: PoolClient, actor: Actor, id: string, requireActive = true) {
  assertSource(actor, id);
  const row = (
    await client.query(`${sourceSelect} WHERE cs.id=$1 FOR UPDATE OF cs`, [id])
  ).rows[0];
  if (!row) fail(404, "Source not found");
  if (requireActive && row.state !== "active") fail(409, "Source must be active");
  return row;
}
export async function audit(
  pool: Pool | PoolClient,
  actor: Actor,
  action: string,
  resourceId?: string,
) {
  await pool.query(
    "INSERT INTO app_audit_log(id,actor_user_id,action,resource_id,actor_type) VALUES($1,$2,$3,$4,$5)",
    [
      randomUUID(),
      actor.userId,
      action,
      resourceId ?? null,
      actor.clientKind === "machine" ? "machine" : "session",
    ],
  );
}
