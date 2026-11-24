import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { Pool, PoolClient } from "pg";
import type { Actor } from "../../../packages/contracts/src/access";
import { BatchVisibilityInput } from "../../../packages/contracts/src/collection";
import { Id, ParamsId } from "../../../packages/contracts/src/common";
import { fail } from "../../shared/errors";
import { transaction } from "../../storage/db";
import { getUserRoleStatus } from "../access/index";

const BatchesQuery = Type.Object(
  {
    sourceId: Type.Optional(Id),
    jobId: Type.Optional(Id),
    forProjectId: Type.Optional(Id),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  },
  { additionalProperties: false },
);

export type RequireWritableProject = (db: Pool | PoolClient, actor: Actor, projectId: string) => Promise<unknown>;

export type BatchCommittedHook = (
  client: PoolClient,
  info: { batchId: string; projectId: string; userId: string | null },
) => Promise<void>;

export async function recordCommittedBatch(
  client: PoolClient,
  input: {
    jobId: string;
    sourceId: string;
    sourceLabel: string;
    userId: string | null;
    contentIds: readonly string[];
    visibility?: "private" | "shared";
  },
): Promise<{ batchId: string; itemCount: number; visibility: "private" | "shared" }> {
  let visibility: "private" | "shared" = input.visibility ?? "shared";
  if (!input.visibility && input.userId) {
    const userRow = await getUserRoleStatus(client, input.userId);
    if (userRow?.role === "viewer") visibility = "private";
  }
  const label = `${input.sourceLabel} · ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const { rows: [batch] } = await client.query<{ id: string; visibility: "private" | "shared"; item_count: number }>(
    `INSERT INTO collection_batch(id, job_id, collection_source_id, created_by_user_id, label, item_count, visibility)
     VALUES($1, $2, $3, $4, $5, 0, $6)
     ON CONFLICT (job_id) DO UPDATE SET label = collection_batch.label
     RETURNING id, visibility, item_count`,
    [randomUUID(), input.jobId, input.sourceId, input.userId, label, visibility],
  );
  if (input.contentIds.length > 0) {
    // The batch upsert holds the row lock. Count only newly inserted memberships,
    // so paginated runs and replays never rescan all previously committed pages.
    const { rows: [updated] } = await client.query<{ item_count: number }>(
      `WITH inserted AS (
         INSERT INTO collection_batch_item(batch_id, content_id)
         SELECT $1, UNNEST($2::uuid[])
         ON CONFLICT (batch_id, content_id) DO NOTHING
         RETURNING 1
       ), delta AS (SELECT COUNT(*)::int AS count FROM inserted)
       UPDATE collection_batch SET item_count = item_count + delta.count
       FROM delta WHERE id = $1 AND delta.count > 0
       RETURNING item_count`,
      [batch.id, input.contentIds],
    );
    if (updated) batch.item_count = updated.item_count;
  }
  return { batchId: batch.id, itemCount: batch.item_count, visibility: batch.visibility };
}

export async function batchRoutes(app: FastifyInstance, pool: Pool, project?: {
  assertWritable: RequireWritableProject;
  listBatchIds: (db: Pool, actor: Actor, id: string) => Promise<string[]>;
  onBatchDiscarded?: (client: PoolClient, batchId: string) => Promise<string[]>;
}) {
  const api = app.withTypeProvider<TypeBoxTypeProvider>();
  api.get("/v1/batches", { config: { auth: { access: "authenticated", browserOnly: true } }, schema: { querystring: BatchesQuery } }, async (request) => {
    const actor = request.actor!;
    const isViewer = actor.role === "viewer";
    const limit = request.query.limit ?? 50;
    let attachedIds: string[] | null = null;
    if (request.query.forProjectId) {
      if (!project) fail(500, "Project scope resolver is unavailable");
      await project.assertWritable(pool, actor, request.query.forProjectId);
      attachedIds = await project.listBatchIds(pool, actor, request.query.forProjectId);
    }
    const { rows } = await pool.query<{
      id: string;
      jobId: string | null;
      sourceId: string;
      sourceLabel: string;
      platform: string;
      provider: string;
      deliveryMode: string;
      usageDomain: string;
      label: string;
      itemCount: number;
      visibility: "private" | "shared";
      createdAt: string;
      createdByUserId: string | null;
    }>(
      `SELECT cb.id,
              cb.job_id AS "jobId",
              cb.collection_source_id AS "sourceId",
              cs.label AS "sourceLabel",
              p.code AS platform,
              COALESCE(j.provider, cs.primary_provider) AS provider,
              cs.delivery_mode AS "deliveryMode",
              cs.usage_domain AS "usageDomain",
              cb.label,
              cb.item_count AS "itemCount",
              cb.visibility,
              cb.created_at AS "createdAt",
              cb.created_by_user_id AS "createdByUserId"
       FROM collection_batch cb
       JOIN collection_source cs ON cs.id = cb.collection_source_id
       JOIN source p ON p.id = cs.platform_id
       LEFT JOIN source_collection_job j ON j.id = cb.job_id
       WHERE cb.discarded_at IS NULL
         AND ($1::uuid[] IS NULL OR cb.collection_source_id = ANY($1::uuid[]))
         AND ($2::uuid IS NULL OR cb.collection_source_id = $2)
         AND ($3::uuid IS NULL OR cb.job_id = $3)
         AND (NOT $4::boolean OR cb.visibility = 'shared' OR cb.created_by_user_id = $5::uuid)
         AND ($7::uuid[] IS NULL OR (cs.usage_domain = 'research' AND cb.item_count > 0 AND NOT (cb.id = ANY($7))))
       ORDER BY cb.created_at DESC, cb.id DESC
       LIMIT $6`,
      [
        actor.allowedSourceIds,
        request.query.sourceId ?? null,
        request.query.jobId ?? null,
        isViewer,
        actor.userId ?? null,
        limit,
        attachedIds,
      ],
    );
    return { batches: rows };
  });

  api.patch(
    "/v1/batches/:id/visibility",
    { config: { auth: { access: "admin_mfa", browserOnly: true } }, schema: { params: ParamsId, body: BatchVisibilityInput } },
    async (request) => {
      const actor = request.actor!;
      if (actor.clientKind !== "browser" || actor.role === "viewer") {
        fail(403, "Administrator browser session required");
      }
      return transaction(pool, async (client) => {
        const res = await client.query<{ id: string; visibility: "private" | "shared" }>(
          "UPDATE collection_batch SET visibility=$2 WHERE id=$1 AND discarded_at IS NULL RETURNING id, visibility",
          [request.params.id, request.body.visibility],
        );
        if (!res.rowCount) fail(404, "Batch not found");
        return { updated: true, batch: res.rows[0] };
      });
    },
  );

  api.delete(
    "/v1/batches/:id",
    { config: { auth: { access: "viewer_write", browserOnly: true } }, schema: { params: ParamsId } },
    async (request) => {
      const actor = request.actor!;
      if (actor.clientKind !== "browser") fail(403, "Browser session required");
      return transaction(pool, async (client) => {
        const { rows: [batch] } = await client.query<{
          id: string;
          visibility: "private" | "shared";
          created_by_user_id: string | null;
        }>(
          "SELECT id, visibility, created_by_user_id FROM collection_batch WHERE id=$1 AND discarded_at IS NULL FOR UPDATE",
          [request.params.id],
        );
        if (!batch) fail(404, "Batch not found");
        if (batch.visibility === "shared") fail(403, "Shared batches cannot be discarded");
        if (actor.role === "viewer" && batch.created_by_user_id !== actor.userId) {
          fail(403, "You can only discard your own private batches");
        }
        await client.query(
          "UPDATE collection_batch SET discarded_at=NOW(), discarded_by_user_id=$2 WHERE id=$1",
          [batch.id, actor.userId],
        );
        const affectedProjectIds = project?.onBatchDiscarded
          ? await project.onBatchDiscarded(client, batch.id)
          : [];
        return { discarded: true, batchId: batch.id, affectedProjectIds };
      });
    },
  );
}

export async function createSnapshotBatch(
  client: PoolClient,
  input: {
    sourceId: string;
    userId: string;
    label: string;
    contentIds: readonly string[];
    visibility?: "private" | "shared";
  },
): Promise<{ batchId: string; itemCount: number; visibility: "private" | "shared" }> {
  const batchId = randomUUID();
  const visibility = input.visibility ?? "private";
  await client.query(
    `INSERT INTO collection_batch(id, job_id, collection_source_id, created_by_user_id, label, item_count, visibility)
     VALUES($1, NULL, $2, $3, $4, 0, $5)`,
    [batchId, input.sourceId, input.userId, input.label.slice(0, 140), visibility],
  );
  if (input.contentIds.length > 0) {
    const { rows: [updated] } = await client.query<{ item_count: number }>(
      `WITH inserted AS (
         INSERT INTO collection_batch_item(batch_id, content_id)
         SELECT $1, UNNEST($2::uuid[])
         ON CONFLICT (batch_id, content_id) DO NOTHING
         RETURNING 1
       ), delta AS (SELECT COUNT(*)::int AS count FROM inserted)
       UPDATE collection_batch SET item_count = item_count + delta.count
       FROM delta WHERE id = $1 AND delta.count > 0
       RETURNING item_count`,
      [batchId, input.contentIds],
    );
    return { batchId, itemCount: updated?.item_count ?? 0, visibility };
  }
  return { batchId, itemCount: 0, visibility };
}


export function batchMembership(ids: readonly string[] | undefined, actor?: Actor): import("../content/index").BatchMembership {
  return { contains: (bind, column) => {
    const conditions = [`i.content_id=${column}`, "b.discarded_at IS NULL"];
    if (ids !== undefined) conditions.push(`b.id=ANY(${bind(ids)}::uuid[])`);
    if (column === "d.content_id") conditions.push("b.collection_source_id=d.collection_source_id");
    if (actor?.role === "viewer")
      conditions.push(`(b.visibility='shared' OR b.created_by_user_id=${bind(actor.userId ?? null)}::uuid)`);
    if (actor?.allowedSourceIds)
      conditions.push(`b.collection_source_id=ANY(${bind(actor.allowedSourceIds)}::uuid[])`);
    return `EXISTS (SELECT 1 FROM collection_batch_item i JOIN collection_batch b ON b.id=i.batch_id WHERE ${conditions.join(" AND ")})`;
  } };
}

export function contentVisibility(
  actor?: Pick<Actor, "role" | "userId">,
  options?: { publicOnly?: boolean },
): import("../content/index").BatchMembership {
  return {
    contains: (bind, column) => {
      const sourceMatch =
        column === "d.content_id"
          ? " AND cb.collection_source_id=d.collection_source_id"
          : column === "o.content_id"
            ? " AND cb.collection_source_id=o.collection_source_id"
            : "";
      // Discard removes an asset, not its privacy provenance. Only an active
      // shared/owned membership may override another private membership.
      if (options?.publicOnly) {
        return `(NOT EXISTS (SELECT 1 FROM collection_batch_item cbi JOIN collection_batch cb ON cb.id=cbi.batch_id WHERE cbi.content_id=${column}${sourceMatch} AND cb.visibility='private') OR EXISTS (SELECT 1 FROM collection_batch_item cbi JOIN collection_batch cb ON cb.id=cbi.batch_id WHERE cbi.content_id=${column}${sourceMatch} AND cb.discarded_at IS NULL AND cb.visibility='shared'))`;
      }
      if (actor && actor.role !== "viewer") return "TRUE";
      const userId = bind(actor?.userId ?? null);
      return `(NOT EXISTS (SELECT 1 FROM collection_batch_item cbi JOIN collection_batch cb ON cb.id=cbi.batch_id WHERE cbi.content_id=${column}${sourceMatch} AND cb.visibility='private' AND cb.created_by_user_id IS DISTINCT FROM ${userId}::uuid) OR EXISTS (SELECT 1 FROM collection_batch_item cbi JOIN collection_batch cb ON cb.id=cbi.batch_id WHERE cbi.content_id=${column}${sourceMatch} AND cb.discarded_at IS NULL AND (cb.visibility='shared' OR cb.created_by_user_id=${userId}::uuid)))`;
    },
  };
}

export async function loadAuthorizedBatches(db: Pool | PoolClient, actor: Actor, ids: readonly string[]) {
  if (!ids.length) return [];
  const { rows } = await db.query<{
    batchId: string; jobId: string | null; sourceId: string; sourceLabel: string; platform: string;
    provider: string; deliveryMode: string; label: string; itemCount: number;
    visibility: "private" | "shared"; createdAt: string;
  }>(
    `SELECT b.id AS "batchId", b.job_id AS "jobId", b.collection_source_id AS "sourceId",
       cs.label AS "sourceLabel", p.code AS platform, COALESCE(j.provider,cs.primary_provider) AS provider,
       cs.delivery_mode AS "deliveryMode", b.label, b.item_count AS "itemCount", b.visibility, b.created_at AS "createdAt"
     FROM collection_batch b JOIN collection_source cs ON cs.id=b.collection_source_id
     JOIN source p ON p.id=cs.platform_id LEFT JOIN source_collection_job j ON j.id=b.job_id
     WHERE b.id=ANY($1::uuid[]) AND b.discarded_at IS NULL
       AND ($2::uuid[] IS NULL OR b.collection_source_id=ANY($2))
       AND (NOT $3::boolean OR b.visibility='shared' OR b.created_by_user_id=$4)`,
    [ids, actor.allowedSourceIds, actor.role === "viewer", actor.userId ?? null],
  );
  return rows;
}
